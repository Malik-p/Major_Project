import { Commit, Finding, ImpactAnalysis, PullRequest, Requirement, SourceFile, Task, Test, TraceabilityLink } from '../models/index.js';

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const SEVERITY_WEIGHT = { CRITICAL: 12, HIGH: 5, MEDIUM: 2, LOW: 1 };
const pct = (part, total) => (total ? Math.round((part / total) * 100) : 0);

/** Loads everything the health and dashboard calculations need in one round trip. */
export async function loadProjectState(projectId) {
  const [requirements, tasks, findings, links, reports, tests, files, commits, pullRequests] = await Promise.all([
    Requirement.find({ project: projectId }).sort({ key: 1 }).lean(),
    Task.find({ project: projectId }).lean(),
    Finding.find({ project: projectId }).lean(),
    TraceabilityLink.find({ project: projectId }).lean(),
    ImpactAnalysis.find({ project: projectId, status: 'OPEN' }).lean(),
    Test.find({ project: projectId }).lean(),
    SourceFile.find({ project: projectId }).select('-content').lean(),
    Commit.find({ project: projectId }).lean(),
    PullRequest.find({ project: projectId }).lean()
  ]);
  const counts = {};
  for (const link of links) {
    const id = String(link.requirement);
    counts[id] ??= { TASK: 0, TEST: 0, COMMIT: 0, SOURCE_FILE: 0, PULL_REQUEST: 0, FINDING: 0 };
    counts[id][link.artifactType] += 1;
  }
  return { requirements, tasks, findings, links, reports, tests, files, commits, pullRequests, counts };
}

export function revalidationQueue(state) {
  const openByRequirement = new Map(state.reports.map((report) => [String(report.requirement), report]));
  return state.requirements
    .filter((req) => req.status === 'CHANGED' || openByRequirement.has(String(req._id)))
    .map((req) => {
      const report = openByRequirement.get(String(req._id));
      return {
        _id: req._id, key: req.key, title: req.title, revision: req.revision, changedAt: req.changedAt,
        analyzed: Boolean(report), reportId: report?._id ?? null,
        affected: report?.impacts.length ?? 0, gaps: report?.gaps.length ?? 0
      };
    });
}

export function computeHealth(state) {
  const risks = [];
  const reqRef = (req) => (req ? { _id: req._id, key: req.key, title: req.title } : null);
  const openReports = new Map(state.reports.map((report) => [String(report.requirement), report]));

  for (const req of state.requirements) {
    const counts = state.counts[String(req._id)] ?? { TASK: 0, TEST: 0, COMMIT: 0, SOURCE_FILE: 0 };
    const report = openReports.get(String(req._id));
    if (req.status === 'CHANGED' && !report) {
      risks.push({ severity: 'CRITICAL', category: 'CHANGE_NOT_ANALYZED', title: `${req.key} changed — impact not yet analyzed`, description: `Revision ${req.revision} modified the requirement. Linked tasks, code and tests may be implementing outdated behaviour.`, requirement: reqRef(req), status: 'REQUIRES_REVALIDATION', recommendation: 'Run change-impact analysis for this requirement.' });
    }
    if (report) {
      risks.push({ severity: 'HIGH', category: 'REQUIRES_REVALIDATION', title: `${req.key} requires revalidation`, description: `Change impact analysis found ${report.impacts.length} affected artifact(s) and ${report.gaps.length} gap(s).`, requirement: reqRef(req), status: 'REQUIRES_REVALIDATION', recommendation: 'Work through the impact report, update code and tests, then mark the requirement revalidated.', reportId: report._id });
      for (const risk of report.risks.filter((item) => item.severity === 'HIGH' || item.severity === 'CRITICAL')) {
        risks.push({ severity: risk.severity, category: 'CHANGE_IMPACT', title: `${req.key}: ${risk.title}`, description: risk.reason, requirement: reqRef(req), status: risk.verificationStatus, recommendation: 'See recommended actions in the impact report.', reportId: report._id });
      }
    }
    if (req.status === 'AT_RISK') {
      risks.push({ severity: 'HIGH', category: 'AT_RISK', title: `${req.key} is marked at risk`, description: 'The team flagged this requirement as at risk of not meeting its acceptance criteria.', requirement: reqRef(req), status: 'AT_RISK', recommendation: 'Resolve the linked findings or blockers.' });
    }
    if (counts.TASK === 0 && req.status !== 'DRAFT') {
      risks.push({ severity: 'HIGH', category: 'MISSING_TASK', title: `${req.key} has no linked tasks`, description: 'Requirement has no implementation tasks assigned.', requirement: reqRef(req), status: 'UNVERIFIED', recommendation: 'Create tasks that implement this requirement.' });
    }
    if (counts.TEST === 0 && ['IN_PROGRESS', 'IMPLEMENTED', 'VERIFIED', 'DONE', 'CHANGED', 'AT_RISK'].includes(req.status)) {
      risks.push({ severity: 'HIGH', category: 'MISSING_TEST', title: `${req.key} has no linked automated test`, description: 'Implementation is under way but no test artifact proves the acceptance criteria.', requirement: reqRef(req), status: 'UNVERIFIED', recommendation: 'Add automated tests covering the acceptance criteria.' });
    }
    if (counts.TASK > 0 && counts.COMMIT === 0 && ['IMPLEMENTED', 'DONE', 'VERIFIED'].includes(req.status)) {
      risks.push({ severity: 'MEDIUM', category: 'INCOMPLETE_TRACEABILITY', title: `${req.key} is implemented but has no linked commits`, description: 'No commit evidence is linked to an implemented requirement.', requirement: reqRef(req), status: 'UNVERIFIED', recommendation: 'Sync GitHub or reference the requirement key in commit messages.' });
    }
  }

  for (const test of state.tests.filter((item) => item.status === 'FAILING')) {
    const req = state.requirements.find((r) => String(r._id) === String(test.requirement));
    risks.push({ severity: 'HIGH', category: 'FAILING_TEST', title: `${test.path} is failing`, description: `Test "${test.name}" failed on its last run.`, requirement: reqRef(req), status: 'FAILING', recommendation: 'Fix the failing test or the implementation it covers.' });
  }
  for (const finding of state.findings.filter((f) => f.status !== 'RESOLVED' && ['HIGH', 'CRITICAL'].includes(f.severity))) {
    const req = state.requirements.find((r) => String(r._id) === String(finding.requirement));
    risks.push({ severity: finding.severity, category: 'UNRESOLVED_FINDING', title: `${finding.key || 'Finding'}: ${finding.title}`, description: finding.description || 'High-severity finding is unresolved.', requirement: reqRef(req), status: finding.verificationStatus, recommendation: 'Fix and resolve this finding.' });
  }
  for (const task of state.tasks.filter((t) => t.status === 'BLOCKED')) {
    const req = state.requirements.find((r) => String(r._id) === String(task.requirement));
    risks.push({ severity: 'MEDIUM', category: 'BLOCKED_TASK', title: `${task.key} is blocked`, description: task.description || 'Task cannot proceed due to a dependency.', requirement: reqRef(req), status: 'BLOCKED', recommendation: task.dependencies?.length ? `Unblock dependency ${task.dependencies.join(', ')}.` : 'Resolve the blocker.' });
  }

  risks.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  risks.forEach((risk, index) => { risk.id = `risk-${index + 1}`; });
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const risk of risks) counts[risk.severity.toLowerCase()] += 1;
  const penalty = risks.reduce((sum, risk) => sum + SEVERITY_WEIGHT[risk.severity], 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const byCategory = (category) => risks.filter((risk) => risk.category === category).length;

  return {
    score,
    grade: score >= 80 ? 'HEALTHY' : score >= 60 ? 'NEEDS_ATTENTION' : 'AT_RISK',
    risks,
    summary: {
      total: risks.length, ...counts,
      requirementsWithoutTasks: byCategory('MISSING_TASK'),
      requirementsWithoutTests: byCategory('MISSING_TEST'),
      unresolvedFindings: byCategory('UNRESOLVED_FINDING'),
      blockedTasks: byCategory('BLOCKED_TASK'),
      failingTests: byCategory('FAILING_TEST'),
      incompleteTraceability: byCategory('INCOMPLETE_TRACEABILITY'),
      changedRequirements: byCategory('CHANGE_NOT_ANALYZED') + byCategory('REQUIRES_REVALIDATION')
    },
    revalidation: revalidationQueue(state)
  };
}

export function computeMetrics(state) {
  const { requirements, tasks, findings, tests, files, commits, pullRequests, counts } = state;
  const total = requirements.length;
  const status = (...values) => requirements.filter((req) => values.includes(req.status)).length;
  const fullyTraced = requirements.filter((req) => {
    const c = counts[String(req._id)];
    return c && c.TASK && c.COMMIT && c.SOURCE_FILE && c.TEST;
  }).length;
  const withTests = requirements.filter((req) => counts[String(req._id)]?.TEST).length;
  const openFindings = findings.filter((f) => f.status !== 'RESOLVED');
  const severity = (level) => openFindings.filter((f) => f.severity === level).length;
  const revalidation = revalidationQueue(state);
  return {
    requirements: {
      total, implemented: status('IMPLEMENTED', 'DONE'), verified: status('VERIFIED'), changed: status('CHANGED'),
      atRisk: status('AT_RISK'), inProgress: status('IN_PROGRESS'), draft: status('DRAFT', 'READY', 'ANALYZED'),
      needsRevalidation: revalidation.length,
      requirementCoverage: pct(status('IMPLEMENTED', 'DONE', 'VERIFIED'), total),
      traceabilityCoverage: pct(fullyTraced, total), fullyTraced,
      withTests, withoutTests: total - withTests
    },
    tasks: {
      total: tasks.length, done: tasks.filter((t) => t.status === 'DONE').length,
      inProgress: tasks.filter((t) => t.status === 'IN_PROGRESS').length, review: tasks.filter((t) => t.status === 'REVIEW').length,
      todo: tasks.filter((t) => t.status === 'TODO').length, blocked: tasks.filter((t) => t.status === 'BLOCKED').length
    },
    code: {
      commits: commits.length, pullRequests: pullRequests.length,
      openPullRequests: pullRequests.filter((pr) => pr.state === 'open').length,
      mergedPullRequests: pullRequests.filter((pr) => pr.state === 'merged').length,
      files: files.length, filesAnalyzed: files.filter((f) => f.lastAnalyzedAt).length,
      findings: findings.length, openFindings: openFindings.length, resolvedFindings: findings.length - openFindings.length
    },
    quality: {
      critical: severity('CRITICAL'), high: severity('HIGH'), medium: severity('MEDIUM'), low: severity('LOW') + severity('INFO'),
      tests: tests.length, testsLinked: tests.filter((t) => t.requirement).length,
      passingTests: tests.filter((t) => t.status === 'PASSING').length, failingTests: tests.filter((t) => t.status === 'FAILING').length
    },
    revalidation
  };
}
