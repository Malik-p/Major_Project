import { Finding, ImpactAnalysis, Requirement, RequirementVersion, SourceFile, Task, Test, TraceabilityLink } from '../models/index.js';
import { completeChat, isAiConfigured } from './llm.js';
import { computeHealth, loadProjectState } from './health.js';

const STOP_WORDS = new Set(['which', 'what', 'why', 'show', 'with', 'that', 'this', 'requirement', 'requirements', 'linked', 'files', 'file', 'tests', 'test', 'tasks', 'task', 'affected', 'changed', 'risk', 'does', 'have', 'about', 'the', 'for', 'are', 'need', 'needs']);
const words = (text) => String(text).toLowerCase().match(/[a-z0-9]+/g) ?? [];
const bullet = (items) => items.map((item) => `• ${item}`).join('\n');
const shortDate = (value) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function matchRequirement(question, requirements) {
  const keyMatch = question.match(/req[\s-]*0*(\d{1,4})/i);
  if (keyMatch) return requirements.find((req) => Number(req.key.split('-')[1]) === Number(keyMatch[1])) ?? null;
  const tokens = words(question).filter((word) => word.length > 3 && !STOP_WORDS.has(word));
  let best = null;
  let bestScore = 0;
  for (const req of requirements) {
    const titleWords = new Set(words(req.title));
    const score = tokens.filter((token) => titleWords.has(token) || [...titleWords].some((word) => word.startsWith(token.slice(0, 5)) && token.length >= 5)).length;
    if (score > bestScore) { best = req; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

const describeChange = (change) => {
  if (change.dimension === 'ALLOWED_FORMATS') return `Accepted formats: ${change.before.join(', ') || 'none'} → ${change.after.join(', ')}${change.added?.length ? ` (added ${change.added.join(', ')})` : ''}${change.removed?.length ? ` (removed ${change.removed.join(', ')})` : ''}`;
  if (change.dimension === 'ACCEPTANCE_CRITERIA') return `Acceptance criteria: ${change.added.length} added, ${change.removed.length} removed`;
  if (change.dimension === 'DESCRIPTION') return `Description: "${change.before}" → "${change.after}"`;
  return `${change.label}: ${change.before} → ${change.after}`;
};
const meaningfulChanges = (report) => (report?.changes ?? []).filter((c) => c.dimension !== 'CONSTRAINTS' && (report.changes.some((x) => ['MAX_FILE_SIZE', 'ALLOWED_FORMATS', 'QUANTITY'].includes(x.dimension)) ? c.dimension !== 'DESCRIPTION' : true));

export async function answerQuestion(project, question) {
  const q = question.toLowerCase();
  const requirements = await Requirement.find({ project: project.id }).sort({ key: 1 }).lean();
  const req = matchRequirement(question, requirements);
  const openReports = await ImpactAnalysis.find({ project: project.id, status: 'OPEN' }).populate('requirement', 'key title').sort({ createdAt: -1 }).lean();
  const reportFor = (requirement) => openReports.find((report) => String(report.requirement?._id) === String(requirement._id));
  const respond = (answer, sources) => ({ answer, mode: 'DATABASE', evidence: `Database-backed answer from: ${sources}. No AI was used.` });

  /* Requirements without linked tests */
  if (/(without|no|missing|lack\w*|not have)\s.{0,20}tests?/.test(q) || /untested/.test(q)) {
    const links = await TraceabilityLink.find({ project: project.id, artifactType: 'TEST' }).lean();
    const tested = new Set(links.map((link) => String(link.requirement)));
    const untested = requirements.filter((r) => !tested.has(String(r._id)));
    if (!untested.length) return respond('Every requirement has at least one linked automated test.', 'traceability links');
    return respond(`${untested.length} of ${requirements.length} requirements have no linked automated test:\n${bullet(untested.map((r) => `${r.key} ${r.title} — ${r.status.replaceAll('_', ' ')}${['DRAFT', 'READY'].includes(r.status) ? ' (not started yet)' : ' (implementation under way — coverage gap)'}`))}`, 'requirements, traceability links (TEST)');
  }

  /* Tests that need revalidation */
  if (/tests?/.test(q) && /revalid|re-?run|need|affected|update/.test(q)) {
    const reports = req ? openReports.filter((report) => String(report.requirement?._id) === String(req._id)) : openReports;
    const items = reports.flatMap((report) => report.impacts.filter((i) => i.artifactType === 'TEST').map((i) => ({ ...i, req: report.requirement.key })));
    if (!items.length) {
      const scope = req ? req.key : 'the project';
      return respond(`No tests currently require revalidation for ${scope}. Tests are flagged only after a requirement change has been analysed${req?.status === 'CHANGED' ? ` — ${req.key} has changed but its impact has not been analysed yet` : ''}.`, 'impact reports');
    }
    const gaps = reports.flatMap((report) => report.gaps.filter((g) => g.artifactType === 'TEST'));
    return respond(`${items.length} test file(s) require revalidation:\n${bullet(items.map((i) => `${i.title} (${i.req}) — ${i.reason}`))}${gaps.length ? `\n\nCoverage gaps found in the test source:\n${bullet(gaps.map((g) => g.title))}` : ''}`, 'open impact reports, stored test source');
  }

  if (req) {
    const report = reportFor(req);
    const [tasks, files, tests, findings, versions] = await Promise.all([
      Task.find({ requirement: req._id }).sort({ key: 1 }).lean(),
      TraceabilityLink.find({ requirement: req._id, artifactType: 'SOURCE_FILE' }).lean().then((links) => SourceFile.find({ _id: { $in: links.map((l) => l.artifact) } }).select('-content').lean()),
      Test.find({ requirement: req._id }).select('-content').lean(),
      Finding.find({ requirement: req._id }).lean(),
      RequirementVersion.find({ requirement: req._id }).sort({ version: -1 }).lean()
    ]);
    const openFindings = findings.filter((f) => f.status !== 'RESOLVED');
    const sources = `${req.key}, its tasks, source files, tests, findings${report ? ', open impact report' : ''}`;

    /* What changed */
    if (/what changed|what.*change|changes|history|difference|before|previous/.test(q)) {
      if (!versions.length) return respond(`${req.key} "${req.title}" has not changed since it was created (revision ${req.revision}).`, `${req.key} version history`);
      const latest = versions[0];
      const lines = report ? meaningfulChanges(report).map(describeChange) : [`Previous description: "${latest.description}"`, `Current description: "${req.description}"`];
      return respond(`${req.key} changed from revision ${latest.version} to ${req.revision} on ${shortDate(req.changedAt ?? latest.createdAt)}:\n${bullet(lines)}\n\n${report ? `Impact analysis has been run: ${report.impacts.length} affected artifact(s), ${report.gaps.length} gap(s).` : latest.impactStatus === 'RESOLVED' ? 'The change was analysed and revalidated.' : 'Change impact has not been analysed yet.'}`, `${req.key} version history${report ? ', impact report' : ''}`);
    }

    /* Affected / linked tasks */
    if (/tasks?/.test(q)) {
      if (report) {
        const items = report.impacts.filter((i) => i.artifactType === 'TASK');
        return respond(`Tasks affected by the latest ${req.key} change:\n${bullet(items.map((i) => `${i.key} ${i.title} — ${i.level.replaceAll('_', ' ')} (${Math.round(i.confidence * 100)}%): ${i.reason}`))}${report.unaffected.some((u) => u.artifactType === 'TASK') ? `\n\nReviewed, no impact expected: ${report.unaffected.filter((u) => u.artifactType === 'TASK').map((u) => u.key).join(', ')}` : ''}`, `${req.key} impact report`);
      }
      return respond(`${req.key} has ${tasks.length} linked task(s):\n${bullet(tasks.map((t) => `${t.key} ${t.title} — ${t.status.replaceAll('_', ' ')} (${t.assignee || 'unassigned'})`))}\n\nNo open change-impact report exists for ${req.key}, so no task is currently flagged as affected.`, sources);
    }

    /* Linked source files */
    if (/files?|code|source|implement/.test(q)) {
      const affected = new Map((report?.impacts ?? []).filter((i) => i.artifactType === 'SOURCE_FILE').map((i) => [i.title, i]));
      return respond(`${files.length} source file(s) are linked to ${req.key} "${req.title}":\n${bullet(files.map((f) => `${f.path} — ${f.summary}${affected.has(f.path) ? ` [${affected.get(f.path).level.replaceAll('_', ' ')}: ${affected.get(f.path).reason}]` : ''}`))}\n\nTests: ${tests.map((t) => `${t.path} (${t.status})`).join(', ') || 'none'}`, sources);
    }

    /* Why at risk / status — the default answer for any requirement-specific question */
    {
      const reasons = [];
      if (req.status === 'CHANGED') {
        reasons.push(`It was modified (revision ${req.revision}, ${shortDate(req.changedAt)}) and now REQUIRES REVALIDATION.`);
        if (report) {
          reasons.push(`What changed:\n${bullet(meaningfulChanges(report).map(describeChange))}`);
          const direct = report.impacts.filter((i) => i.level === 'DIRECTLY_AFFECTED');
          reasons.push(`Directly affected: ${direct.map((i) => i.key).join(', ')}`);
          reasons.push(`Tests requiring revalidation: ${report.impacts.filter((i) => i.artifactType === 'TEST').map((i) => i.key).join(', ') || 'none'}`);
          if (report.gaps.length) reasons.push(`Verified gaps:\n${bullet(report.gaps.map((g) => `${g.title} (${g.evidence.split('\n')[0]})`))}`);
          if (report.risks.length) reasons.push(`Risks:\n${bullet(report.risks.map((r) => `${r.severity}: ${r.title}`))}`);
        } else {
          reasons.push('Its change impact has not been analysed yet — run "Analyze Change Impact" on the requirement.');
        }
      }
      if (req.status === 'AT_RISK') reasons.push('The team marked it AT RISK.');
      const serious = openFindings.filter((f) => ['CRITICAL', 'HIGH'].includes(f.severity));
      if (serious.length) reasons.push(`Unresolved high-severity findings:\n${bullet(serious.map((f) => `${f.key} [${f.severity}] ${f.title}`))}`);
      const blocked = tasks.filter((t) => t.status === 'BLOCKED');
      if (blocked.length) reasons.push(`Blocked tasks: ${blocked.map((t) => `${t.key} (depends on ${t.dependencies.join(', ') || 'unknown'})`).join(', ')}`);
      if (!tests.length && !['DRAFT', 'READY'].includes(req.status)) reasons.push('No automated test is linked.');
      const failing = tests.filter((t) => t.status === 'FAILING');
      if (failing.length) reasons.push(`Failing tests: ${failing.map((t) => t.path).join(', ')}`);
      if (!reasons.length) {
        return respond(`${req.key} "${req.title}" is not currently at risk.\n${bullet([
          `Status: ${req.status.replaceAll('_', ' ')}, revision ${req.revision}, owner ${req.owner || 'unassigned'}`,
          `Tasks: ${tasks.map((t) => `${t.key} (${t.status})`).join(', ') || 'none'}`,
          `Tests: ${tests.map((t) => `${t.path} (${t.status})`).join(', ') || 'none'}`,
          `Open findings: ${openFindings.map((f) => `${f.key} [${f.severity}]`).join(', ') || 'none'}`
        ])}`, sources);
      }
      return respond(`${req.key} "${req.title}" is at risk because:\n${reasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}`, sources);
    }
  }

  /* Findings */
  if (/finding|issue|vulnerab|severity|security/.test(q)) {
    const findings = await Finding.find({ project: project.id, status: { $ne: 'RESOLVED' } }).populate('requirement', 'key').lean();
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
    findings.sort((a, b) => order[a.severity] - order[b.severity]);
    return respond(findings.length ? `${findings.length} open finding(s), most severe first:\n${bullet(findings.map((f) => `${f.key} [${f.severity}] ${f.title} — ${f.requirement?.key ?? 'unlinked'}, ${f.verificationStatus.replaceAll('_', ' ')}`))}` : 'There are no open findings.', 'findings');
  }

  /* Blocked tasks */
  if (/block/.test(q)) {
    const blocked = await Task.find({ project: project.id, status: 'BLOCKED' }).populate('requirement', 'key').lean();
    return respond(blocked.length ? `${blocked.length} blocked task(s):\n${bullet(blocked.map((t) => `${t.key} ${t.title} (${t.requirement?.key}) — depends on ${t.dependencies.join(', ') || 'unspecified'}, assigned to ${t.assignee}`))}` : 'No tasks are blocked.', 'tasks');
  }

  /* Project-wide risk / revalidation */
  if (/risk|revalid|attention|health/.test(q)) {
    const health = computeHealth(await loadProjectState(project.id));
    const top = health.risks.slice(0, 8);
    return respond(`Project health score: ${health.score}/100 (${health.grade.replaceAll('_', ' ')}).\nRequirements requiring revalidation: ${health.revalidation.length ? health.revalidation.map((r) => r.key).join(', ') : 'none'}.\n\nTop risks:\n${bullet(top.map((r) => `${r.severity}: ${r.title}`))}`, 'risk engine over requirements, tasks, tests, findings and impact reports');
  }

  if (isAiConfigured()) {
    try {
      const [tasks, findings] = await Promise.all([Task.find({ project: project.id }).populate('requirement', 'key').lean(), Finding.find({ project: project.id }).lean()]);
      const answer = await completeChat([
        { role: 'system', content: 'Answer using only the supplied project data. If the data does not answer the question, say so. Cite requirement, task and finding keys. Never claim something is verified unless its verificationStatus is VERIFIED.' },
        { role: 'user', content: JSON.stringify({ question, project: project.name, requirements, tasks, findings, openImpactReports: openReports.map((r) => ({ requirement: r.requirement?.key, changes: r.changes, gaps: r.gaps, risks: r.risks })) }) }
      ]);
      return { answer, mode: 'AI_SUGGESTION', evidence: 'Generated by the configured AI provider from current project records; not independently verified.' };
    } catch (error) {
      return { ...summary(project, requirements), mode: 'DATABASE_FALLBACK', evidence: `AI provider unavailable (${error.message}); showing a database-backed summary instead.` };
    }
  }
  return summary(project, requirements);
}

function summary(project, requirements) {
  const byStatus = requirements.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  return {
    answer: `${project.name} has ${requirements.length} requirements (${Object.entries(byStatus).map(([s, n]) => `${n} ${s.replaceAll('_', ' ').toLowerCase()}`).join(', ')}).\n\nI answer from stored project data. Try:\n${bullet(['Why is REQ-006 at risk?', 'Which tasks are affected by REQ-006?', 'Which files are linked to the profile image requirement?', 'What changed in REQ-006?', 'Which tests need revalidation?', 'Show requirements without linked tests.'])}`,
    mode: 'DATABASE',
    evidence: 'Database-backed answer from: requirements. No AI was used.'
  };
}
