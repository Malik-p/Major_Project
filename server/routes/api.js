import { Router } from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  Activity, User, Project, Requirement, RequirementVersion, Task, Sprint, Commit, PullRequest,
  SourceFile, Test, Finding, TraceabilityLink, ImpactAnalysis
} from '../models/index.js';
import { authenticate } from '../middleware/auth.js';
import { asyncRoute } from '../utils/asyncRoute.js';
import { completeChat, isAiConfigured, parseJsonResponse } from '../services/llm.js';
import { syncRepository } from '../services/github.js';
import { fail } from '../utils/errors.js';
import { getDatabaseStatus } from '../config/db.js';
import { addLink, artifactModels, loadLinkedArtifacts, nextKey } from '../services/traceability.js';
import { analyzeRequirementChange, markFindingsForRevalidation } from '../services/impact.js';
import { computeHealth, computeMetrics, loadProjectState } from '../services/health.js';
import { logActivity } from '../services/activity.js';
import { reviewSource } from '../services/review.js';
import { answerQuestion } from '../services/assistant.js';
import { DEMO_EMAIL, DEMO_PASSWORD, demoModeEnabled, demoWorkspaceExists, ensureDemoUser, seedDemoWorkspace } from '../demo/seedDemo.js';

const router = Router();
const CONTENT_FIELDS = ['title', 'description', 'acceptanceCriteria'];

/* ═══════════════════════════════════════════════════════════════════════════
   AUTH
   ═══════════════════════════════════════════════════════════════════════════ */

router.get('/auth/config', (req, res) => {
  res.json(demoModeEnabled() ? { demoMode: true, demoEmail: DEMO_EMAIL, demoPassword: DEMO_PASSWORD } : { demoMode: false });
});

router.post('/auth/register', asyncRoute(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? '') || typeof password !== 'string' || password.length < 8) {
    throw fail(400, 'Provide a name, valid email, and password with at least 8 characters');
  }
  const user = await User.create({ name: name.trim(), email, passwordHash: await bcrypt.hash(password, 12) });
  res.status(201).json({ user: publicUser(user), token: issueToken(user) });
}));

router.post('/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: String(email ?? '').toLowerCase() });
  if (!user || !(await bcrypt.compare(String(password ?? ''), user.passwordHash))) throw fail(401, 'Email or password is incorrect');
  res.json({ user: publicUser(user), token: issueToken(user) });
}));

// One-click examiner access: signs in as the seeded demo account. Disabled when DEMO_MODE is off.
router.post('/auth/demo', asyncRoute(async (req, res) => {
  if (!demoModeEnabled()) throw fail(403, 'Demo mode is disabled on this server');
  if (!(await demoWorkspaceExists())) await seedDemoWorkspace();
  const user = await ensureDemoUser();
  res.json({ user: publicUser(user), token: issueToken(user) });
}));

router.use(authenticate);
router.get('/auth/me', (req, res) => res.json({ user: req.user }));

router.get('/system', (req, res) => {
  res.json({
    database: getDatabaseStatus(),
    aiConfigured: isAiConfigured(),
    aiModel: isAiConfigured() ? (process.env.AI_MODEL || 'gpt-4o-mini') : null,
    githubConfigured: Boolean(process.env.GITHUB_TOKEN),
    demoMode: demoModeEnabled(),
    isDemoUser: req.user.email === DEMO_EMAIL
  });
});

router.post('/demo/reset', asyncRoute(async (req, res) => {
  if (!demoModeEnabled() || req.user.email !== DEMO_EMAIL) throw fail(403, 'Only the demo account can reset the demo workspace');
  const { project } = await seedDemoWorkspace();
  res.json({ projectId: project.id });
}));

/* ═══════════════════════════════════════════════════════════════════════════
   PROJECTS
   ═══════════════════════════════════════════════════════════════════════════ */

router.get('/projects', asyncRoute(async (req, res) => {
  const projects = await Project.find({ $or: [{ owner: req.user.id }, { members: req.user.id }] }).sort({ isDemo: -1, updatedAt: -1 });
  res.json({ projects });
}));

router.post('/projects', asyncRoute(async (req, res) => {
  if (!req.body.name?.trim()) throw fail(400, 'Project name is required');
  const project = await Project.create({
    name: req.body.name.trim(),
    description: req.body.description ?? '',
    repository: req.body.repositoryUrl ? parseRepositoryUrl(req.body.repositoryUrl) : {},
    owner: req.user.id,
    members: [req.user.id]
  });
  await logActivity(project.id, 'PROJECT', `Project ${project.name} created`, req.user.name);
  res.status(201).json({ project });
}));

router.get('/projects/:projectId', asyncRoute(async (req, res) => {
  res.json({ project: await getProject(req.params.projectId, req.user.id) });
}));

router.patch('/projects/:projectId', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  for (const field of ['name', 'description', 'status']) {
    if (req.body[field] !== undefined) project[field] = req.body[field];
  }
  if (req.body.repositoryUrl !== undefined) {
    project.repository = req.body.repositoryUrl ? parseRepositoryUrl(req.body.repositoryUrl) : { owner: '', name: '', url: '' };
  }
  await project.save();
  res.json({ project });
}));

router.delete('/projects/:projectId', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  if (String(project.owner) !== String(req.user.id)) throw fail(403, 'Only the project owner can delete this project');
  await Promise.all([Requirement, Task, Sprint, Commit, PullRequest, SourceFile, Test, Finding, TraceabilityLink, ImpactAnalysis, RequirementVersion, Activity]
    .map((Model) => Model.deleteMany({ project: project.id })));
  await project.deleteOne();
  res.status(204).end();
}));

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD, HEALTH & ACTIVITY
   ═══════════════════════════════════════════════════════════════════════════ */

router.get('/projects/:projectId/dashboard', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  const state = await loadProjectState(project.id);
  const health = computeHealth(state);
  const [tasks, activity, commits, pullRequests] = await Promise.all([
    Task.find({ project: project.id }).populate('requirement', 'key title').sort({ updatedAt: -1 }),
    Activity.find({ project: project.id }).sort({ at: -1 }).limit(12),
    Commit.find({ project: project.id }).populate('requirement', 'key').sort({ committedAt: -1 }).limit(5),
    PullRequest.find({ project: project.id }).populate('requirement', 'key').sort({ updatedAt: -1 }).limit(5)
  ]);
  res.json({
    project,
    metrics: computeMetrics(state),
    health: { score: health.score, grade: health.grade, summary: health.summary, topRisks: health.risks.slice(0, 5) },
    requirements: state.requirements,
    tasks,
    findings: state.findings.filter((f) => f.status !== 'RESOLVED'),
    commits, pullRequests, activity
  });
}));

router.get('/projects/:projectId/health', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  res.json(computeHealth(await loadProjectState(project.id)));
}));

router.get('/projects/:projectId/activity', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  res.json({ activity: await Activity.find({ project: project.id }).sort({ at: -1 }).limit(50) });
}));

/* ═══════════════════════════════════════════════════════════════════════════
   REQUIREMENTS
   ═══════════════════════════════════════════════════════════════════════════ */

router.get('/projects/:projectId/requirements', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  const filter = { project: project.id };
  for (const field of ['status', 'priority', 'type']) if (req.query[field]) filter[field] = String(req.query[field]);
  if (req.query.search) {
    const term = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = ['title', 'description', 'key'].map((field) => ({ [field]: { $regex: term, $options: 'i' } }));
  }
  const [requirements, links] = await Promise.all([
    Requirement.find(filter).sort({ key: 1 }).lean(),
    TraceabilityLink.find({ project: project.id }).lean()
  ]);
  for (const requirement of requirements) {
    const own = links.filter((link) => String(link.requirement) === String(requirement._id));
    requirement.traceCounts = Object.fromEntries(Object.keys(artifactModels).map((type) => [type, own.filter((link) => link.artifactType === type).length]));
  }
  res.json({ requirements });
}));

router.post('/projects/:projectId/requirements', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  if (!req.body.title?.trim()) throw fail(400, 'Requirement title is required');
  const requirement = await Requirement.create({
    key: await nextKey(Requirement, project.id, 'REQ'),
    title: req.body.title.trim(),
    description: req.body.description ?? '',
    type: req.body.type ?? 'FUNCTIONAL',
    priority: req.body.priority ?? 'MEDIUM',
    status: req.body.status ?? 'DRAFT',
    owner: req.body.owner ?? req.user.name,
    acceptanceCriteria: req.body.acceptanceCriteria ?? [],
    project: project.id,
    createdBy: req.user.id
  });
  await logActivity(project.id, 'REQUIREMENT', `${requirement.key} created — "${requirement.title}"`, req.user.name);
  res.status(201).json({ requirement });
}));

router.get('/requirements/:requirementId', asyncRoute(async (req, res) => {
  const requirement = await getRequirement(req.params.requirementId, req.user.id);
  const [pendingVersions, openReport] = await Promise.all([
    RequirementVersion.countDocuments({ requirement: requirement.id, impactStatus: 'PENDING' }),
    ImpactAnalysis.findOne({ requirement: requirement.id, status: 'OPEN' }).select('_id createdAt impacts gaps').lean()
  ]);
  res.json({
    requirement,
    changeState: {
      pendingAnalysis: pendingVersions > 0,
      openReport: openReport ? { _id: openReport._id, createdAt: openReport.createdAt, affected: openReport.impacts.length, gaps: openReport.gaps.length } : null
    }
  });
}));

router.patch('/requirements/:requirementId', asyncRoute(async (req, res) => {
  const requirement = await getRequirement(req.params.requirementId, req.user.id);
  const normalizeList = (value) => (Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : value);
  if (req.body.acceptanceCriteria !== undefined) req.body.acceptanceCriteria = normalizeList(req.body.acceptanceCriteria);
  const changed = CONTENT_FIELDS.some((key) =>
    req.body[key] !== undefined && JSON.stringify(req.body[key]) !== JSON.stringify(key === 'acceptanceCriteria' ? [...requirement[key]] : requirement[key])
  );
  const previous = requirement.toObject();
  for (const field of ['title', 'description', 'priority', 'status', 'acceptanceCriteria', 'type', 'owner']) {
    if (req.body[field] !== undefined) requirement[field] = req.body[field];
  }
  if (changed) {
    await RequirementVersion.create({
      requirement: requirement.id, project: requirement.project, version: previous.revision,
      title: previous.title, description: previous.description, type: previous.type || 'FUNCTIONAL',
      priority: previous.priority, status: previous.status, acceptanceCriteria: previous.acceptanceCriteria,
      changeSummary: generateChangeSummary(previous, requirement), changedBy: req.user.id, impactStatus: 'PENDING'
    });
    requirement.revision += 1;
    requirement.changedAt = new Date();
    requirement.status = 'CHANGED';
  }
  await requirement.save();
  if (changed) {
    await logActivity(requirement.project, 'REQUIREMENT', `${requirement.key} requirement updated (v${previous.revision} → v${requirement.revision}) — ${generateChangeSummary(previous, requirement)}`, req.user.name);
  } else if (previous.status !== requirement.status) {
    await logActivity(requirement.project, 'REQUIREMENT', `${requirement.key} marked ${requirement.status.replaceAll('_', ' ')}`, req.user.name);
  }
  res.json({ requirement, changed });
}));

router.delete('/requirements/:requirementId', asyncRoute(async (req, res) => {
  const requirement = await getRequirement(req.params.requirementId, req.user.id);
  await Promise.all([Task, TraceabilityLink, ImpactAnalysis, RequirementVersion, Commit, PullRequest, SourceFile, Test, Finding]
    .map((Model) => Model.deleteMany({ requirement: requirement.id })));
  await requirement.deleteOne();
  await logActivity(requirement.project, 'REQUIREMENT', `${requirement.key} deleted`, req.user.name);
  res.status(204).end();
}));

router.get('/requirements/:requirementId/history', asyncRoute(async (req, res) => {
  const requirement = await getRequirement(req.params.requirementId, req.user.id);
  res.json({ versions: await RequirementVersion.find({ requirement: requirement.id }).sort({ version: -1 }) });
}));

/* ─── Change impact ───────────────────────────────────────────────────── */

router.post('/requirements/:requirementId/impact-analysis', asyncRoute(async (req, res) => {
  const requirement = await getRequirement(req.params.requirementId, req.user.id);
  const pending = await RequirementVersion.find({ requirement: requirement.id, impactStatus: 'PENDING' }).sort({ version: 1 });
  const baseline = pending[0];
  if (!baseline) throw fail(409, `${requirement.key} has no unanalyzed changes. Edit its description or acceptance criteria first.`);
  const { report, findingUpdates } = await analyzeRequirementChange({
    requirement: requirement.toObject(),
    previous: { title: baseline.title, description: baseline.description, acceptanceCriteria: baseline.acceptanceCriteria },
    fromVersion: baseline.version,
    toVersion: requirement.revision
  });
  await ImpactAnalysis.updateMany({ requirement: requirement.id, status: 'OPEN' }, { $set: { status: 'SUPERSEDED' } });
  const saved = await ImpactAnalysis.create({ ...report, requirement: requirement.id, project: requirement.project });
  await RequirementVersion.updateMany({ requirement: requirement.id, impactStatus: 'PENDING' }, { $set: { impactStatus: 'ANALYZED' } });
  await markFindingsForRevalidation(findingUpdates);
  if (requirement.status !== 'CHANGED') { requirement.status = 'CHANGED'; await requirement.save(); }
  await logActivity(requirement.project, 'IMPACT', `Change impact analyzed for ${requirement.key}: ${saved.impacts.length} affected artifacts, ${saved.gaps.length} gaps — requires revalidation`, req.user.name);
  res.status(201).json({ report: await saved.populate('requirement', 'key title') });
}));

router.post('/requirements/:requirementId/revalidate', asyncRoute(async (req, res) => {
  const requirement = await getRequirement(req.params.requirementId, req.user.id);
  const open = await ImpactAnalysis.find({ requirement: requirement.id, status: 'OPEN' });
  if (!open.length && requirement.status !== 'CHANGED') throw fail(409, `${requirement.key} has nothing awaiting revalidation`);
  if (!open.length) throw fail(409, `Analyze the change impact of ${requirement.key} before revalidating it`);
  await ImpactAnalysis.updateMany({ requirement: requirement.id, status: 'OPEN' }, { $set: { status: 'RESOLVED', resolvedAt: new Date() } });
  await RequirementVersion.updateMany({ requirement: requirement.id, impactStatus: { $ne: 'RESOLVED' } }, { $set: { impactStatus: 'RESOLVED' } });
  const findingIds = open.flatMap((report) => report.impacts.filter((i) => i.artifactType === 'FINDING').map((i) => i.artifact));
  await Finding.updateMany({ _id: { $in: findingIds }, verificationStatus: 'REQUIRES_REVALIDATION' }, { $set: { verificationStatus: 'UNVERIFIED' } });
  requirement.status = 'VERIFIED';
  await requirement.save();
  await logActivity(requirement.project, 'IMPACT', `${requirement.key} revalidated — impact report resolved`, req.user.name);
  res.json({ requirement });
}));

/* ─── AI requirement analysis ─────────────────────────────────────────── */

router.post('/requirements/:requirementId/analyze', asyncRoute(async (req, res) => {
  const requirement = await getRequirement(req.params.requirementId, req.user.id);
  const aiContent = await completeChat([
    { role: 'system', content: 'Analyze requirements and return JSON only: {"acceptanceCriteria":["..."],"edgeCases":["..."],"validationRules":["..."],"developmentTasks":["..."],"potentialRisks":["..."],"suggestedTests":["..."]}. Keep every generated item specific and label all output as suggestions, not verified facts.' },
    { role: 'user', content: JSON.stringify({ title: requirement.title, description: requirement.description, existingAcceptanceCriteria: requirement.acceptanceCriteria }) }
  ], { json: true });
  if (aiContent) {
    const result = parseJsonResponse(aiContent);
    const asStrings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);
    res.json({
      mode: 'AI_SUGGESTION',
      acceptanceCriteria: asStrings(result.acceptanceCriteria), edgeCases: asStrings(result.edgeCases),
      validationRules: asStrings(result.validationRules), developmentTasks: asStrings(result.developmentTasks),
      potentialRisks: asStrings(result.potentialRisks), suggestedTests: asStrings(result.suggestedTests)
    });
    return;
  }
  res.json({ mode: 'RULE_BASED', ...ruleBasedRequirementAnalysis(requirement) });
}));

/* ═══════════════════════════════════════════════════════════════════════════
   TASKS
   ═══════════════════════════════════════════════════════════════════════════ */

router.get('/projects/:projectId/tasks', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  res.json({ tasks: await Task.find({ project: project.id }).populate('requirement', 'key title').sort({ key: 1 }) });
}));

router.post('/projects/:projectId/tasks', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  const requirement = await getRequirement(req.body.requirement, req.user.id);
  if (String(requirement.project) !== String(project.id)) throw fail(400, 'Requirement must belong to this project');
  if (!req.body.title?.trim()) throw fail(400, 'Task title is required');
  const task = await Task.create({
    key: await nextKey(Task, project.id, 'TASK'),
    title: req.body.title.trim(), description: req.body.description ?? '',
    status: req.body.status || 'TODO', priority: req.body.priority || 'MEDIUM',
    assignee: req.body.assignee ?? '', estimate: req.body.estimate ?? '',
    dueDate: req.body.dueDate || undefined,
    sprint: req.body.sprint ?? '', dependencies: req.body.dependencies ?? [],
    requirement: requirement.id, project: project.id
  });
  await addLink(requirement.id, 'TASK', task.id, project.id);
  await logActivity(project.id, 'TASK', `${task.key} created for ${requirement.key} — "${task.title}"`, req.user.name);
  res.status(201).json({ task });
}));

router.patch('/tasks/:taskId', asyncRoute(async (req, res) => {
  const task = await Task.findById(req.params.taskId);
  if (!task) throw fail(404, 'Task not found');
  await getProject(task.project, req.user.id);
  const previousStatus = task.status;
  for (const field of ['title', 'description', 'status', 'priority', 'assignee', 'estimate', 'dueDate', 'sprint', 'dependencies']) {
    if (req.body[field] !== undefined) task[field] = req.body[field];
  }
  await task.save();
  if (previousStatus !== task.status) {
    await logActivity(task.project, 'TASK', `${task.key} moved to ${task.status.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())} — "${task.title}"`, req.user.name);
  }
  res.json({ task });
}));

router.delete('/tasks/:taskId', asyncRoute(async (req, res) => {
  const task = await Task.findById(req.params.taskId);
  if (!task) throw fail(404, 'Task not found');
  await getProject(task.project, req.user.id);
  await Promise.all([TraceabilityLink.deleteMany({ artifact: task.id }), task.deleteOne()]);
  res.status(204).end();
}));

/* ═══════════════════════════════════════════════════════════════════════════
   TRACEABILITY
   ═══════════════════════════════════════════════════════════════════════════ */

router.get('/projects/:projectId/traceability', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  const [requirements, links, tasks, files, tests, findings, commits, pullRequests] = await Promise.all([
    Requirement.find({ project: project.id }).sort({ key: 1 }).lean(),
    TraceabilityLink.find({ project: project.id }).lean(),
    Task.find({ project: project.id }).select('key status title').lean(),
    SourceFile.find({ project: project.id }).select('path').lean(),
    Test.find({ project: project.id }).select('path status name').lean(),
    Finding.find({ project: project.id }).select('key severity status').lean(),
    Commit.find({ project: project.id }).select('sha').lean(),
    PullRequest.find({ project: project.id }).select('number state').lean()
  ]);
  const byId = new Map([...tasks, ...files, ...tests, ...findings, ...commits, ...pullRequests].map((item) => [String(item._id), item]));
  const rows = requirements.map((requirement) => {
    const own = links.filter((link) => String(link.requirement) === String(requirement._id));
    const pick = (type) => own.filter((link) => link.artifactType === type).map((link) => byId.get(String(link.artifact))).filter(Boolean);
    const row = {
      requirement: { _id: requirement._id, key: requirement.key, title: requirement.title, type: requirement.type, status: requirement.status },
      tasks: pick('TASK').sort((a, b) => a.key.localeCompare(b.key)), files: pick('SOURCE_FILE'), tests: pick('TEST'),
      findings: pick('FINDING'), commits: pick('COMMIT').length, pullRequests: pick('PULL_REQUEST').length
    };
    const stages = [row.tasks.length, row.commits, row.files.length, row.tests.length].filter(Boolean).length;
    row.completeness = requirement.status === 'CHANGED' ? 'REVALIDATE' : stages === 4 ? 'COMPLETE' : stages === 0 ? 'NONE' : 'PARTIAL';
    row.stages = stages;
    return row;
  });
  res.json({ rows });
}));

router.get('/projects/:projectId/traceability/:requirementId', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  if (!mongoose.isValidObjectId(req.params.requirementId)) throw fail(404, 'Requirement not found');
  const requirement = await Requirement.findOne({ _id: req.params.requirementId, project: project.id });
  if (!requirement) throw fail(404, 'Requirement not found');
  const { artifacts, links } = await loadLinkedArtifacts(requirement._id);
  const openReport = await ImpactAnalysis.findOne({ requirement: requirement.id, status: 'OPEN' }).select('impacts').lean();
  const impactByArtifact = Object.fromEntries((openReport?.impacts ?? []).map((item) => [String(item.artifact), item]));
  res.json({ requirement, artifacts, links, impactByArtifact, reportId: openReport?._id ?? null });
}));

router.get('/projects/:projectId/artifacts/:type/:artifactId', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  const Model = artifactModels[req.params.type];
  if (!Model || !mongoose.isValidObjectId(req.params.artifactId)) throw fail(404, 'Artifact not found');
  const artifact = await Model.findOne({ _id: req.params.artifactId, project: project.id }).lean();
  if (!artifact) throw fail(404, 'Artifact not found');
  const links = await TraceabilityLink.find({ artifact: artifact._id }).lean();
  const requirementIds = [...new Set([...links.map((l) => String(l.requirement)), artifact.requirement && String(artifact.requirement)].filter(Boolean))];
  const lean = (query) => query.select('-content').lean();
  const related = { requirements: await Requirement.find({ _id: { $in: requirementIds } }).select('key title status').lean() };
  const taskId = req.params.type === 'TASK' ? artifact._id : artifact.task;
  if (taskId) related.task = await Task.findById(taskId).select('key title status assignee').lean();
  const path = artifact.path;
  if (req.params.type === 'TASK') {
    Object.assign(related, {
      commits: await lean(Commit.find({ task: artifact._id }).sort({ committedAt: 1 })),
      pullRequests: await lean(PullRequest.find({ task: artifact._id })),
      files: await lean(SourceFile.find({ task: artifact._id })),
      tests: await lean(Test.find({ task: artifact._id }))
    });
  } else if (req.params.type === 'COMMIT') {
    Object.assign(related, {
      files: await lean(SourceFile.find({ project: project.id, path: { $in: artifact.files } })),
      tests: await lean(Test.find({ project: project.id, path: { $in: artifact.files } })),
      pullRequests: await lean(PullRequest.find({ project: project.id, changedFiles: { $in: artifact.files } }))
    });
  } else if (req.params.type === 'PULL_REQUEST') {
    Object.assign(related, {
      commits: await lean(Commit.find({ project: project.id, files: { $in: artifact.changedFiles } }).sort({ committedAt: 1 })),
      files: await lean(SourceFile.find({ project: project.id, path: { $in: artifact.changedFiles } })),
      tests: await lean(Test.find({ project: project.id, path: { $in: artifact.changedFiles } }))
    });
  } else if (req.params.type === 'SOURCE_FILE' || req.params.type === 'TEST') {
    Object.assign(related, {
      commits: await lean(Commit.find({ project: project.id, files: path }).sort({ committedAt: 1 })),
      pullRequests: await lean(PullRequest.find({ project: project.id, changedFiles: path })),
      findings: await lean(Finding.find({ project: project.id, filePath: path }))
    });
  } else if (req.params.type === 'FINDING' && artifact.filePath) {
    related.files = await lean(SourceFile.find({ project: project.id, path: artifact.filePath }));
  }
  res.json({ type: req.params.type, artifact, related });
}));

/* ═══════════════════════════════════════════════════════════════════════════
   GITHUB
   ═══════════════════════════════════════════════════════════════════════════ */

router.post('/projects/:projectId/github/sync', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  if (project.isDemo) throw fail(400, 'This is a demo repository. Connect a real GitHub repository to a project to sync live data.');
  const result = await syncRepository(project);
  await logActivity(project.id, 'COMMIT', `Synced ${result.syncedCommits} commits and ${result.syncedPullRequests} pull requests from ${result.repository.fullName}`, req.user.name);
  res.json({ ...result, mode: 'LIVE' });
}));

router.get('/projects/:projectId/github', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  const [commits, pullRequests] = await Promise.all([
    Commit.find({ project: project.id }).populate('requirement', 'key title').populate('task', 'key title').sort({ committedAt: -1 }),
    PullRequest.find({ project: project.id }).populate('requirement', 'key title').populate('task', 'key title').sort({ number: -1 })
  ]);
  const ready = Boolean(process.env.GITHUB_TOKEN && project.repository?.owner && project.repository?.name);
  const mode = project.isDemo ? 'DEMO' : ready ? (commits.some((c) => !c.isDemo) ? 'LIVE' : 'READY') : 'NOT_CONNECTED';
  const notice = {
    DEMO: 'DEMO GITHUB DATA — demo repository records seeded for this workspace. This is not live GitHub activity.',
    LIVE: 'Live repository activity synced from GitHub.',
    READY: 'Repository connected. Use Sync repository to fetch commits, pull requests and changed files.',
    NOT_CONNECTED: 'Add a github.com repository URL to the project and set GITHUB_TOKEN to enable live synchronisation.'
  }[mode];
  res.json({ mode, notice, repository: project.repository, commits, pullRequests });
}));

/* ═══════════════════════════════════════════════════════════════════════════
   IMPACT ANALYSIS
   ═══════════════════════════════════════════════════════════════════════════ */

router.get('/projects/:projectId/impact-analysis', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  const [reports, pendingVersions] = await Promise.all([
    ImpactAnalysis.find({ project: project.id, status: { $ne: 'SUPERSEDED' } }).populate('requirement', 'key title status').sort({ createdAt: -1 }),
    RequirementVersion.find({ project: project.id, impactStatus: 'PENDING' }).lean()
  ]);
  const pendingIds = [...new Set(pendingVersions.map((v) => String(v.requirement)))];
  const pending = await Requirement.find({ _id: { $in: pendingIds } }).select('key title revision changedAt').lean();
  res.json({ reports, pending });
}));

/* ═══════════════════════════════════════════════════════════════════════════
   CODE REVIEW
   ═══════════════════════════════════════════════════════════════════════════ */

router.post('/projects/:projectId/reviews/analyze', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  const { filePath, sourceCode, requirementId } = req.body;
  if (typeof filePath !== 'string' || !filePath.trim() || typeof sourceCode !== 'string' || !sourceCode.trim()) {
    throw fail(400, 'filePath and sourceCode are required');
  }
  if (sourceCode.length > 30000) throw fail(413, 'Source code must be 30,000 characters or fewer');
  let requirement;
  if (requirementId) {
    requirement = await getRequirement(requirementId, req.user.id);
    if (String(requirement.project) !== String(project.id)) throw fail(400, 'Requirement must belong to this project');
  }
  let resultFindings = reviewSource(filePath, sourceCode, requirement);
  let mode = 'RULE_BASED_ANALYZER';
  const content = await completeChat([
    { role: 'system', content: 'Review the supplied source code. Return JSON only: {"findings":[{"title":"...","severity":"CRITICAL|HIGH|MEDIUM|LOW|INFO","category":"...","description":"...","evidence":"a concise exact code excerpt or location","confidence":0.0}]}. Identify only plausible issues supported by the provided source. If no issue is found, return an empty findings list.' },
    { role: 'user', content: JSON.stringify({ filePath, requirement: requirement ? { key: requirement.key, title: requirement.title, description: requirement.description, criteria: requirement.acceptanceCriteria } : null, sourceCode }) }
  ], { json: true });
  if (content) {
    const result = parseJsonResponse(content);
    if (Array.isArray(result.findings)) {
      resultFindings = [...resultFindings, ...result.findings.map((item) => ({ ...item, verificationStatus: 'AI_SUGGESTION' }))];
      mode = 'RULE_BASED_AND_AI';
    }
  }
  // Skip anything already recorded as an open finding for the same file and title.
  const existing = await Finding.find({ project: project.id, filePath, status: 'OPEN' }).select('title').lean();
  const known = new Set(existing.map((f) => f.title.toLowerCase()));
  const created = [];
  for (const item of resultFindings) {
    if (!item || typeof item.title !== 'string' || !['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].includes(item.severity) || known.has(item.title.toLowerCase())) continue;
    const finding = await Finding.create({
      key: await nextKey(Finding, project.id, 'FIND'),
      title: item.title, severity: item.severity, category: String(item.category ?? 'CODE_QUALITY').toUpperCase(),
      description: item.description, evidence: item.evidence,
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.7)),
      verificationStatus: item.verificationStatus ?? 'UNVERIFIED', source: item.verificationStatus === 'AI_SUGGESTION' ? 'AI_REVIEW' : 'RULE_ENGINE',
      filePath, project: project.id, requirement: requirement?.id
    });
    if (requirement) await addLink(requirement.id, 'FINDING', finding.id, project.id);
    created.push(finding);
  }
  await SourceFile.updateMany({ project: project.id, path: filePath }, { $set: { lastAnalyzedAt: new Date() } });
  if (created.length) {
    await logActivity(project.id, 'REVIEW', `Code review of ${filePath.split('/').pop()} raised ${created.map((f) => f.key).join(', ')}${requirement ? ` for ${requirement.key}` : ''}`, req.user.name);
  }
  res.json({
    mode,
    notice: created.length
      ? `${created.length} new finding(s) recorded for ${filePath}. Requirement mismatches are line-cited (VERIFIED); heuristic matches are UNVERIFIED${mode === 'RULE_BASED_AND_AI' ? '; AI findings are AI SUGGESTIONS' : ''}.`
      : `No new issues found in ${filePath}${resultFindings.length ? ' (matches were already recorded as open findings)' : ''}.`,
    findings: created
  });
}));

router.get('/projects/:projectId/reviews', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  const [findings, files] = await Promise.all([
    Finding.find({ project: project.id }).populate('requirement', 'key title').sort({ status: 1, createdAt: -1 }),
    SourceFile.find({ project: project.id, content: { $ne: '' } }).populate('requirement', 'key').select('path content requirement').sort({ path: 1 }).lean()
  ]);
  res.json({ aiConfigured: isAiConfigured(), findings, files });
}));

router.patch('/findings/:findingId', asyncRoute(async (req, res) => {
  const finding = await Finding.findById(req.params.findingId);
  if (!finding) throw fail(404, 'Finding not found');
  await getProject(finding.project, req.user.id);
  const previous = finding.status;
  if (req.body.status !== undefined) finding.status = req.body.status;
  if (req.body.verificationStatus !== undefined) finding.verificationStatus = req.body.verificationStatus;
  await finding.save();
  if (previous !== finding.status) await logActivity(finding.project, 'REVIEW', `${finding.key} ${finding.status === 'RESOLVED' ? 'resolved' : 'reopened'} — ${finding.title}`, req.user.name);
  res.json({ finding });
}));

/* ═══════════════════════════════════════════════════════════════════════════
   PROJECT ASSISTANT
   ═══════════════════════════════════════════════════════════════════════════ */

router.post('/projects/:projectId/assistant', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  const question = String(req.body.question ?? '').trim();
  if (!question) throw fail(400, 'Question is required');
  if (question.length > 500) throw fail(400, 'Question must be 500 characters or fewer');
  res.json(await answerQuestion(project, question));
}));

/* ═══════════════════════════════════════════════════════════════════════════
   SPRINTS
   ═══════════════════════════════════════════════════════════════════════════ */

router.get('/projects/:projectId/sprints', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  res.json({ sprints: await Sprint.find({ project: project.id }).sort({ startsAt: 1 }) });
}));

router.post('/projects/:projectId/sprints', asyncRoute(async (req, res) => {
  const project = await getProject(req.params.projectId, req.user.id);
  const { name, goal, startsAt, endsAt, status } = req.body;
  if (!name?.trim()) throw fail(400, 'Sprint name is required');
  const sprint = await Sprint.create({
    project: project.id, name: name.trim(), goal: goal ?? '',
    startsAt: startsAt ? new Date(startsAt) : new Date(),
    endsAt: endsAt ? new Date(endsAt) : new Date(Date.now() + 14 * 86400000),
    status: status || 'PLANNED'
  });
  res.status(201).json({ sprint });
}));

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function issueToken(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function parseRepositoryUrl(value) {
  try {
    const parsed = new URL(value);
    const [owner, name] = parsed.pathname.split('/').filter(Boolean);
    if (parsed.hostname !== 'github.com' || !owner || !name) throw new Error();
    const repositoryName = name.replace(/\.git$/, '');
    return { owner, name: repositoryName, url: `https://github.com/${owner}/${repositoryName}` };
  } catch {
    throw fail(400, 'Repository URL must be a valid github.com/owner/repository URL');
  }
}

async function getProject(id, userId) {
  if (!id || !mongoose.isValidObjectId(id)) throw fail(404, 'Project not found');
  const project = await Project.findOne({ _id: id, $or: [{ owner: userId }, { members: userId }] });
  if (!project) throw fail(404, 'Project not found');
  return project;
}

async function getRequirement(id, userId) {
  if (!id || !mongoose.isValidObjectId(id)) throw fail(404, 'Requirement not found');
  const requirement = await Requirement.findById(id);
  if (!requirement) throw fail(404, 'Requirement not found');
  await getProject(requirement.project, userId);
  return requirement;
}

function generateChangeSummary(previous, current) {
  const parts = [];
  if (previous.title !== current.title) parts.push('title changed');
  if (previous.description !== current.description) parts.push('description changed');
  if (JSON.stringify(previous.acceptanceCriteria) !== JSON.stringify([...current.acceptanceCriteria])) parts.push('acceptance criteria modified');
  if (previous.priority !== current.priority) parts.push(`priority ${previous.priority} → ${current.priority}`);
  return parts.join('; ') || 'content updated';
}

function ruleBasedRequirementAnalysis(requirement) {
  const text = `${requirement.title} ${requirement.description} ${requirement.acceptanceCriteria.join(' ')}`.toLowerCase();
  const edgeCases = [];
  const validationRules = [];
  const suggestedTests = [];
  const size = text.match(/(\d+(?:\.\d+)?)\s*(kb|mb|gb)/);
  if (size) {
    edgeCases.push(`File of exactly ${size[1]} ${size[2].toUpperCase()} (boundary)`, `File of ${size[1]} ${size[2].toUpperCase()} + 1 byte`, 'Empty (0-byte) file');
    validationRules.push(`Reject files larger than ${size[1]} ${size[2].toUpperCase()} with HTTP 413`);
    suggestedTests.push(`Accepts a file of exactly ${size[1]} ${size[2].toUpperCase()}`, `Rejects a file one byte over ${size[1]} ${size[2].toUpperCase()}`);
  }
  if (/jpe?g|png|webp|gif|format/.test(text)) {
    edgeCases.push('File whose extension does not match its MIME type', 'Uppercase file extension (e.g. .PNG)');
    validationRules.push('Validate MIME type from file content, not only the extension');
    suggestedTests.push('Rejects an unsupported format with HTTP 415');
  }
  if (/password|token|auth|login/.test(text)) {
    edgeCases.push('Expired or tampered token', 'Repeated failed attempts');
    validationRules.push('Never reveal whether an account exists in error messages');
  }
  if (/\d+\s*(requests?|minutes?)/.test(text)) {
    edgeCases.push('Request exactly at the limit', 'Requests spanning a window boundary');
    suggestedTests.push('Returns 429 on the first request over the limit');
  }
  if (/order|payment|stock|amount/.test(text)) {
    edgeCases.push('Concurrent requests for the last unit of stock', 'Client-supplied amount differs from server total');
    validationRules.push('Compute monetary amounts on the server only');
  }
  if (!edgeCases.length) edgeCases.push('Missing or empty input', 'Unauthorised user attempts the action');
  return {
    acceptanceCriteria: requirement.acceptanceCriteria,
    edgeCases,
    validationRules: validationRules.length ? validationRules : ['Validate all inputs on the server before persisting'],
    developmentTasks: requirement.acceptanceCriteria.slice(0, 4).map((criterion) => `Implement and test: ${criterion}`),
    potentialRisks: requirement.acceptanceCriteria.length < 3 ? ['Few acceptance criteria — behaviour may be under-specified'] : [],
    suggestedTests: suggestedTests.length ? suggestedTests : requirement.acceptanceCriteria.map((criterion) => `Verify: ${criterion}`)
  };
}

export default router;
