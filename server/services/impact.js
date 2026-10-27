import { Finding } from '../models/index.js';
import { loadLinkedArtifacts } from './traceability.js';
import { completeChat, isAiConfigured, parseJsonResponse } from './llm.js';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTRAINT EXTRACTION
   Pulls structured, comparable constraints out of free-text requirements:
   file-size limits, accepted formats and numeric limits (requests, minutes…).
   ═══════════════════════════════════════════════════════════════════════════ */

const UNIT_BYTES = { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
const FORMAT_NAMES = { jpeg: 'JPEG', jpg: 'JPEG', png: 'PNG', webp: 'WebP', gif: 'GIF', svg: 'SVG', heic: 'HEIC', avif: 'AVIF', bmp: 'BMP', pdf: 'PDF' };
const FORMAT_PATTERN = /\b(jpe?g|png|webp|gif|svg|heic|avif|bmp|pdf)\b/gi;
const QUANTITY_UNITS = {
  request: 'requests', requests: 'requests', minute: 'minutes', minutes: 'minutes', hour: 'hours', hours: 'hours',
  second: 'seconds', seconds: 'seconds', day: 'days', days: 'days', attempt: 'attempts', attempts: 'attempts',
  character: 'characters', characters: 'characters', item: 'items', items: 'items', result: 'results', results: 'results'
};

const unique = (values) => [...new Set(values)];
const formatSize = (bytes) => bytes >= UNIT_BYTES.mb ? `${+(bytes / UNIT_BYTES.mb).toFixed(2)} MB` : `${+(bytes / UNIT_BYTES.kb).toFixed(2)} KB`;
const fileName = (path = '') => path.split('/').pop();

function extractFromText(text) {
  const value = String(text ?? '');
  const sizes = [...value.matchAll(/(\d+(?:\.\d+)?)\s*(kb|mb|gb)\b/gi)]
    .map((m) => Math.round(Number(m[1]) * UNIT_BYTES[m[2].toLowerCase()]));
  const formats = unique([...value.matchAll(FORMAT_PATTERN)].map((m) => FORMAT_NAMES[m[1].toLowerCase()]));
  const quantities = [...value.matchAll(/(\d+(?:\.\d+)?)[\s-]*(requests?|minutes?|hours?|seconds?|days?|attempts?|characters?|items?|results?)\b/gi)]
    .map((m) => ({ value: Number(m[1]), unit: QUANTITY_UNITS[m[2].toLowerCase()] }));
  return { sizes, formats, quantities };
}

/** Requirement-level constraints. The description is authoritative; criteria fill gaps. */
export function requirementConstraints(snapshot) {
  const description = extractFromText(`${snapshot.title ?? ''} ${snapshot.description ?? ''}`);
  const criteria = extractFromText((snapshot.acceptanceCriteria ?? []).join('\n'));
  const maxSize = description.sizes[0] ?? criteria.sizes[0] ?? null;
  const formats = description.formats.length ? description.formats : criteria.formats;
  const quantities = {};
  for (const item of [...criteria.quantities, ...description.quantities]) quantities[item.unit] = item.value;
  return { maxSize, formats, quantities };
}

export function describeConstraints(constraints) {
  return {
    maxSize: constraints.maxSize ? formatSize(constraints.maxSize) : null,
    formats: constraints.formats,
    quantities: Object.entries(constraints.quantities).map(([unit, value]) => `${value} ${unit}`)
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SOURCE INSPECTION
   Scans a stored source/test snapshot line by line for size limits,
   MIME/format allow-lists and literal numeric values.
   ═══════════════════════════════════════════════════════════════════════════ */

export function inspectSource(content) {
  const lines = String(content ?? '').split('\n');
  const sizeRefs = [];
  const formatRefs = [];
  lines.forEach((text, index) => {
    const line = index + 1;
    const bytes = new Set();
    for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*\*\s*1024\s*\*\s*1024/g)) bytes.add(Math.round(Number(m[1]) * UNIT_BYTES.mb));
    for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*\*\s*1024(?!\s*\*)/g)) {
      if (!/\*\s*1024\s*\*\s*1024/.test(text.slice(m.index))) bytes.add(Math.round(Number(m[1]) * UNIT_BYTES.kb));
    }
    for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(MB|KB)\b/gi)) bytes.add(Math.round(Number(m[1]) * UNIT_BYTES[m[2].toLowerCase()]));
    for (const value of bytes) sizeRefs.push({ line, text: text.trim(), bytes: value });
    const formats = unique([...text.matchAll(/image\/(jpe?g|png|webp|gif|svg\+?x?m?l?|heic|avif|bmp)/gi)]
      .map((m) => FORMAT_NAMES[m[1].toLowerCase().replace(/\+.*$/, '')]).filter(Boolean));
    if (formats.length) formatRefs.push({ line, text: text.trim(), formats });
  });
  return { lines, sizeRefs, formatRefs, allFormats: unique(formatRefs.flatMap((ref) => ref.formats)) };
}

function findLiteral(lines, value) {
  const pattern = new RegExp(`(^|[^\\d.])${String(value).replace('.', '\\.')}(?![\\d.])`);
  return lines.map((text, index) => ({ line: index + 1, text: text.trim() })).filter((entry) => pattern.test(entry.text) && !entry.text.startsWith('//'));
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHANGE DETECTION
   ═══════════════════════════════════════════════════════════════════════════ */

const normalize = (text) => String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function detectChanges(previous, current) {
  const before = requirementConstraints(previous);
  const after = requirementConstraints(current);
  const changes = [];
  if (before.maxSize !== after.maxSize && (before.maxSize || after.maxSize)) {
    changes.push({
      dimension: 'MAX_FILE_SIZE', label: 'Maximum file size',
      before: before.maxSize ? formatSize(before.maxSize) : 'Not specified',
      after: after.maxSize ? formatSize(after.maxSize) : 'Not specified',
      direction: !before.maxSize ? 'ADDED' : !after.maxSize ? 'REMOVED' : after.maxSize < before.maxSize ? 'TIGHTENED' : 'RELAXED'
    });
  }
  const addedFormats = after.formats.filter((format) => !before.formats.includes(format));
  const removedFormats = before.formats.filter((format) => !after.formats.includes(format));
  if (addedFormats.length || removedFormats.length) {
    changes.push({ dimension: 'ALLOWED_FORMATS', label: 'Accepted formats', before: before.formats, after: after.formats, added: addedFormats, removed: removedFormats });
  }
  for (const unit of unique([...Object.keys(before.quantities), ...Object.keys(after.quantities)])) {
    if (before.quantities[unit] !== after.quantities[unit]) {
      changes.push({ dimension: 'QUANTITY', unit, label: `Limit (${unit})`, before: before.quantities[unit] ?? 'Not specified', after: after.quantities[unit] ?? 'Not specified' });
    }
  }
  if (normalize(previous.title) !== normalize(current.title)) {
    changes.push({ dimension: 'TITLE', label: 'Title', before: previous.title, after: current.title });
  }
  const previousCriteria = (previous.acceptanceCriteria ?? []).map(normalize);
  const currentCriteria = (current.acceptanceCriteria ?? []).map(normalize);
  const addedCriteria = (current.acceptanceCriteria ?? []).filter((item) => !previousCriteria.includes(normalize(item)));
  const removedCriteria = (previous.acceptanceCriteria ?? []).filter((item) => !currentCriteria.includes(normalize(item)));
  if (addedCriteria.length || removedCriteria.length) {
    changes.push({ dimension: 'ACCEPTANCE_CRITERIA', label: 'Acceptance criteria', added: addedCriteria, removed: removedCriteria });
  }
  if (normalize(previous.description) !== normalize(current.description)) {
    changes.push({ dimension: 'DESCRIPTION', label: 'Description', before: previous.description, after: current.description });
  }
  return { before, after, changes };
}

/* ═══════════════════════════════════════════════════════════════════════════
   IMPACT ANALYSIS
   ═══════════════════════════════════════════════════════════════════════════ */

const DIMENSION_KEYWORDS = {
  MAX_FILE_SIZE: /size|limit|validat|boundar/i,
  ALLOWED_FORMATS: /type|format|mime|validat/i,
  QUANTITY: /limit|rate|window|throttl|quota|config/i
};

export async function analyzeRequirementChange({ requirement, previous, fromVersion, toVersion }) {
  const current = { title: requirement.title, description: requirement.description, acceptanceCriteria: requirement.acceptanceCriteria };
  const { before, after, changes } = detectChanges(previous, current);
  const { artifacts } = await loadLinkedArtifacts(requirement._id);
  const key = requirement.key;
  const sizeChange = changes.find((c) => c.dimension === 'MAX_FILE_SIZE');
  const formatChange = changes.find((c) => c.dimension === 'ALLOWED_FORMATS');
  const quantityChanges = changes.filter((c) => c.dimension === 'QUANTITY');
  const structured = Boolean(sizeChange || formatChange || quantityChanges.length);
  const impacts = [];
  const gaps = [];
  const unaffected = [];
  const recommendations = [];
  const risks = [];

  /* ── Source files ──────────────────────────────────────────────────────── */
  const fileFindings = new Map(); // path -> { stale: [], missingFormats: [] }
  const affectedPaths = new Set();
  for (const file of artifacts.SOURCE_FILE) {
    const result = inspectFile(file.content, { before, after, sizeChange, formatChange, quantityChanges });
    fileFindings.set(file.path, result);
    const name = fileName(file.path);
    if (!file.content) {
      affectedPaths.add(file.path);
      impacts.push({ level: 'POTENTIALLY_AFFECTED', artifactType: 'SOURCE_FILE', artifact: file._id, key: name, title: file.path,
        reason: `Linked to ${key}, but no source snapshot is stored, so the file could not be inspected.`,
        evidence: 'Traceability link only — no code inspected.', confidence: 0.5, verificationStatus: 'UNVERIFIED' });
      continue;
    }
    if (result.evidence.length) {
      affectedPaths.add(file.path);
      const verified = result.stale.length > 0 || result.missingFormats.length > 0;
      impacts.push({ level: verified ? 'DIRECTLY_AFFECTED' : 'POTENTIALLY_AFFECTED', artifactType: 'SOURCE_FILE', artifact: file._id, key: name, title: file.path,
        reason: result.reasons.join(' ') || `References values that changed in ${key}.`,
        evidence: result.evidence.map((e) => `L${e.line}: ${e.text}`).join('\n'),
        confidence: verified ? 0.95 : 0.7, verificationStatus: verified ? 'VERIFIED' : 'REQUIRES_REVALIDATION' });
      for (const stale of result.stale) {
        gaps.push({ level: 'GAP', artifactType: 'SOURCE_FILE', artifact: file._id, key: name,
          title: `Maximum file size is still configured as ${formatSize(stale.bytes)} in ${name}`,
          reason: `${key} now requires ${sizeChange.after}.`, evidence: `${file.path} L${stale.line}: ${stale.text}`,
          confidence: 0.97, verificationStatus: 'VERIFIED' });
      }
      if (result.missingFormats.length) {
        const ref = result.formatRefs[0];
        gaps.push({ level: 'GAP', artifactType: 'SOURCE_FILE', artifact: file._id, key: name,
          title: `${result.missingFormats.join(', ')} MIME type is not in the allow-list in ${name}`,
          reason: `${key} now accepts ${after.formats.join(', ')}.`, evidence: `${file.path} L${ref.line}: ${ref.text}`,
          confidence: 0.96, verificationStatus: 'VERIFIED' });
      }
      for (const removed of result.stillAccepted) {
        gaps.push({ level: 'GAP', artifactType: 'SOURCE_FILE', artifact: file._id, key: name,
          title: `${removed.formats.join(', ')} is still accepted in ${name}`, reason: `${key} no longer allows it.`,
          evidence: `${file.path} L${removed.line}: ${removed.text}`, confidence: 0.95, verificationStatus: 'VERIFIED' });
      }
    } else if (!structured) {
      affectedPaths.add(file.path);
      impacts.push({ level: 'POTENTIALLY_AFFECTED', artifactType: 'SOURCE_FILE', artifact: file._id, key: name, title: file.path,
        reason: `Implements ${key}; the requirement wording changed, so behaviour should be reviewed.`,
        evidence: 'Change is descriptive (no measurable constraint changed); manual review required.', confidence: 0.55, verificationStatus: 'UNVERIFIED' });
    } else {
      unaffected.push({ level: 'NO_IMPACT', artifactType: 'SOURCE_FILE', artifact: file._id, key: name, title: file.path,
        reason: `Inspected ${result.lineCount} lines: no reference to the changed size, format or limit values.`,
        evidence: 'Source snapshot inspected.', confidence: 0.85, verificationStatus: 'VERIFIED' });
    }
  }

  /* ── Tests ─────────────────────────────────────────────────────────────── */
  const affectedTests = [];
  let boundaryCovered = false;
  const formatCoverage = new Set();
  for (const test of artifacts.TEST) {
    const name = fileName(test.path || test.name);
    if (!test.content) {
      affectedTests.push(test);
      impacts.push({ level: 'REQUIRES_REVALIDATION', artifactType: 'TEST', artifact: test._id, key: name, title: test.path || test.name,
        reason: `Validates ${key}; must be re-run against the updated requirement.`, evidence: 'No test source stored — cannot inspect assertions.',
        confidence: 0.7, verificationStatus: 'REQUIRES_REVALIDATION' });
      continue;
    }
    const scan = inspectSource(test.content);
    scan.allFormats.forEach((format) => formatCoverage.add(format));
    for (const m of test.content.matchAll(FORMAT_PATTERN)) formatCoverage.add(FORMAT_NAMES[m[1].toLowerCase()]);
    if (after.maxSize && scan.sizeRefs.some((ref) => ref.bytes === after.maxSize)) boundaryCovered = true;
    const evidence = [];
    const reasons = [];
    if (sizeChange) {
      const stale = scan.sizeRefs.filter((ref) => ref.bytes === before.maxSize);
      const between = after.maxSize && before.maxSize
        ? scan.sizeRefs.filter((ref) => ref.bytes > Math.min(after.maxSize, before.maxSize) && ref.bytes <= Math.max(after.maxSize, before.maxSize) && ref.bytes !== before.maxSize)
        : [];
      if (stale.length) { evidence.push(...stale); reasons.push(`Asserts the previous ${sizeChange.before} boundary.`); }
      if (between.length) {
        evidence.push(...between);
        reasons.push(`Uses ${unique(between.map((ref) => formatSize(ref.bytes))).join(', ')} fixtures whose expected result flips under the ${sizeChange.after} limit.`);
      }
      if (!stale.length && !between.length && scan.sizeRefs.length) { evidence.push(...scan.sizeRefs.slice(0, 2)); reasons.push('Exercises file-size rules that changed.'); }
    }
    if (formatChange && scan.formatRefs.length) {
      evidence.push(...scan.formatRefs.slice(0, 2));
      if (formatChange.added.some((format) => !scan.allFormats.includes(format))) reasons.push(`Covers ${scan.allFormats.join('/')} only — no ${formatChange.added.join('/')} case.`);
    }
    for (const change of quantityChanges) {
      const hits = typeof change.before === 'number' ? findLiteral(scan.lines, change.before) : [];
      if (hits.length) { evidence.push(...hits.slice(0, 2)); reasons.push(`Asserts the previous ${change.before} ${change.unit} value.`); }
    }
    if (evidence.length || !structured) {
      affectedTests.push(test);
      impacts.push({ level: 'REQUIRES_REVALIDATION', artifactType: 'TEST', artifact: test._id, key: name, title: test.path || test.name,
        reason: reasons.join(' ') || `Validates ${key}; must be re-run against the updated requirement.`,
        evidence: evidence.length ? unique(evidence.map((e) => `L${e.line}: ${e.text}`)).join('\n') : `Last run: ${test.status}.`,
        confidence: evidence.length ? 0.92 : 0.7, verificationStatus: 'REQUIRES_REVALIDATION' });
    } else {
      unaffected.push({ level: 'NO_IMPACT', artifactType: 'TEST', artifact: test._id, key: name, title: test.path || test.name,
        reason: 'Inspected test source: no assertions on the changed values.', evidence: 'Test snapshot inspected.', confidence: 0.8, verificationStatus: 'VERIFIED' });
    }
  }
  const testsInspected = artifacts.TEST.some((test) => test.content);
  if (formatChange?.added.length && testsInspected) {
    const missing = formatChange.added.filter((format) => !formatCoverage.has(format));
    if (missing.length) {
      gaps.push({ level: 'GAP', artifactType: 'TEST', key: 'tests', title: `Existing tests do not cover ${missing.join(', ')} uploads`,
        reason: `No linked test references ${missing.join('/')}.`, evidence: `Inspected ${artifacts.TEST.map((t) => fileName(t.path)).join(', ')}.`,
        confidence: 0.93, verificationStatus: 'VERIFIED' });
    }
  }
  if (sizeChange && after.maxSize && testsInspected && !boundaryCovered) {
    gaps.push({ level: 'GAP', artifactType: 'TEST', key: 'tests', title: `Boundary test for exactly ${sizeChange.after} is missing`,
      reason: 'No linked test uses a fixture equal to the new limit.', evidence: `No ${sizeChange.after} fixture found in ${artifacts.TEST.map((t) => fileName(t.path)).join(', ')}.`,
      confidence: 0.9, verificationStatus: 'VERIFIED' });
  }

  /* ── Acceptance criteria consistency ───────────────────────────────────── */
  (current.acceptanceCriteria ?? []).forEach((criterion, index) => {
    const sizes = extractFromText(criterion).sizes;
    if (after.maxSize && sizes.some((size) => size !== after.maxSize)) {
      gaps.push({ level: 'GAP', artifactType: 'REQUIREMENT', key, title: `Acceptance criterion ${index + 1} still references ${formatSize(sizes.find((s) => s !== after.maxSize))}`,
        reason: `The description now specifies ${formatSize(after.maxSize)}.`, evidence: `AC${index + 1}: "${criterion}"`, confidence: 0.98, verificationStatus: 'VERIFIED' });
    }
  });
  if (formatChange?.added.length) {
    const criteriaFormats = extractFromText((current.acceptanceCriteria ?? []).join('\n')).formats;
    const uncovered = formatChange.added.filter((format) => !criteriaFormats.includes(format));
    if (uncovered.length) {
      gaps.push({ level: 'GAP', artifactType: 'REQUIREMENT', key, title: `No acceptance criterion covers ${uncovered.join(', ')}`,
        reason: 'The description adds the format but the definition of done does not test for it.', evidence: `Criteria mention: ${criteriaFormats.join(', ') || 'no formats'}.`,
        confidence: 0.95, verificationStatus: 'VERIFIED' });
      recommendations.push(`Add acceptance criterion: "${uncovered.join(' and ')} images are accepted."`);
    }
  }

  /* ── Tasks ─────────────────────────────────────────────────────────────── */
  const changedDimensions = unique(changes.map((c) => c.dimension)).filter((d) => DIMENSION_KEYWORDS[d]);
  const affectedTestTaskIds = new Set(affectedTests.map((test) => String(test.task)));
  for (const task of artifacts.TASK) {
    const text = `${task.title} ${task.description ?? ''}`;
    const isTestTask = /\btests?\b|\bqa\b|spec/i.test(task.title);
    const ownedFiles = artifacts.SOURCE_FILE.filter((file) => String(file.task) === String(task._id) && affectedPaths.has(file.path));
    const matched = changedDimensions.filter((dimension) => DIMENSION_KEYWORDS[dimension].test(text));
    const label = `${task.key} · ${task.title}`;
    if (isTestTask && (affectedTests.length || affectedTestTaskIds.has(String(task._id)))) {
      impacts.push({ level: 'POTENTIALLY_AFFECTED', artifactType: 'TASK', artifact: task._id, key: task.key, title: task.title,
        reason: `Existing tests validate the previous rules of ${key} and require revalidation.`,
        evidence: `Linked tests: ${affectedTests.map((t) => fileName(t.path)).join(', ')} (${task.status}).`, confidence: 0.85, verificationStatus: 'REQUIRES_REVALIDATION' });
    } else if (matched.length || (!structured && !isTestTask)) {
      const verifiedFile = ownedFiles.find((file) => fileFindings.get(file.path)?.stale.length || fileFindings.get(file.path)?.missingFormats.length);
      const stale = verifiedFile ? fileFindings.get(verifiedFile.path).evidence[0] : null;
      impacts.push({ level: structured ? 'DIRECTLY_AFFECTED' : 'POTENTIALLY_AFFECTED', artifactType: 'TASK', artifact: task._id, key: task.key, title: task.title,
        reason: structured ? `The task explicitly implements the ${matched.map(dimensionName).join(' and ')} rules changed by ${key}.` : `Implements ${key}; its scope should be reviewed against the new wording.`,
        evidence: stale ? `${fileName(verifiedFile.path)} L${stale.line} (owned by ${task.key}): ${stale.text}` : `Task "${task.title}" matches the changed ${matched.map(dimensionName).join('/') || 'requirement'} scope.`,
        confidence: structured ? 0.95 : 0.6, verificationStatus: stale ? 'VERIFIED' : 'UNVERIFIED' });
    } else if (ownedFiles.length) {
      impacts.push({ level: 'POTENTIALLY_AFFECTED', artifactType: 'TASK', artifact: task._id, key: task.key, title: task.title,
        reason: `Owns ${ownedFiles.map((f) => fileName(f.path)).join(', ')}, which references the changed values.`,
        evidence: ownedFiles.map((f) => { const e = fileFindings.get(f.path)?.evidence[0]; return e ? `${fileName(f.path)} L${e.line}: ${e.text}` : fileName(f.path); }).join('\n'),
        confidence: 0.65, verificationStatus: 'UNVERIFIED' });
    } else {
      unaffected.push({ level: 'NO_IMPACT', artifactType: 'TASK', artifact: task._id, key: task.key, title: task.title,
        reason: 'Task scope and owned files do not reference the changed constraints.', evidence: label, confidence: 0.75, verificationStatus: 'UNVERIFIED' });
    }
  }

  /* ── Commits & pull requests ───────────────────────────────────────────── */
  const touchedPaths = new Set([...affectedPaths, ...affectedTests.map((t) => t.path)]);
  for (const commit of artifacts.COMMIT) {
    const touched = (commit.files ?? []).filter((path) => touchedPaths.has(path));
    const shortSha = commit.sha.slice(0, 7);
    if (touched.length) {
      impacts.push({ level: 'POTENTIALLY_AFFECTED', artifactType: 'COMMIT', artifact: commit._id, key: shortSha, title: commit.message,
        reason: `Introduced code that now needs updating (${touched.map(fileName).join(', ')}).`,
        evidence: `Commit ${shortSha} by ${commit.author} modified ${touched.join(', ')}.`, confidence: 0.75, verificationStatus: 'UNVERIFIED' });
    } else {
      unaffected.push({ level: 'NO_IMPACT', artifactType: 'COMMIT', artifact: commit._id, key: shortSha, title: commit.message,
        reason: 'Did not modify any affected file.', evidence: (commit.files ?? []).join(', '), confidence: 0.8, verificationStatus: 'VERIFIED' });
    }
  }
  for (const pr of artifacts.PULL_REQUEST) {
    const touched = (pr.changedFiles ?? []).filter((path) => touchedPaths.has(path));
    if (touched.length) {
      impacts.push({ level: 'POTENTIALLY_AFFECTED', artifactType: 'PULL_REQUEST', artifact: pr._id, key: `PR #${pr.number}`, title: pr.title,
        reason: `Shipped the ${sizeChange?.before ?? 'previous'} behaviour; a follow-up change is required.`,
        evidence: `PR #${pr.number} (${pr.state}) changed ${touched.map(fileName).join(', ')}.`, confidence: 0.75, verificationStatus: 'UNVERIFIED' });
    }
  }

  /* ── Findings ──────────────────────────────────────────────────────────── */
  const findingUpdates = [];
  for (const finding of artifacts.FINDING.filter((item) => item.status !== 'RESOLVED')) {
    const text = `${finding.title} ${finding.description ?? ''} ${finding.evidence ?? ''}`;
    const mentionsChange = (formatChange && [...formatChange.added, ...formatChange.removed].some((format) => new RegExp(format, 'i').test(text)))
      || (sizeChange && /size|limit|mb/i.test(text)) || touchedPaths.has(finding.filePath) || !structured;
    if (mentionsChange) {
      impacts.push({ level: 'REQUIRES_REVALIDATION', artifactType: 'FINDING', artifact: finding._id, key: finding.key, title: finding.title,
        reason: `The ${key} change directly concerns this finding; it must be re-checked against the new rules.`,
        evidence: finding.evidence || finding.description, confidence: finding.confidence ?? 0.8, verificationStatus: 'REQUIRES_REVALIDATION' });
      findingUpdates.push(finding._id);
    }
  }

  /* ── Risks & recommendations ───────────────────────────────────────────── */
  const staleGaps = gaps.filter((gap) => gap.artifactType === 'SOURCE_FILE' && /Maximum file size/.test(gap.title));
  if (sizeChange) {
    const verified = staleGaps.length > 0;
    risks.push({ severity: sizeChange.direction === 'RELAXED' ? 'MEDIUM' : 'HIGH',
      title: sizeChange.direction === 'RELAXED' ? `Valid uploads between ${sizeChange.before} and ${sizeChange.after} would be rejected` : `Validation implementation does not satisfy the updated ${sizeChange.after} restriction`,
      reason: verified ? `${staleGaps.length} code location(s) still enforce ${sizeChange.before}.` : 'Size enforcement could not be confirmed in stored source.',
      evidence: staleGaps.map((gap) => gap.evidence).join('\n') || 'No inspected source.', confidence: verified ? 0.95 : 0.6, verificationStatus: verified ? 'VERIFIED' : 'UNVERIFIED' });
    for (const gap of staleGaps) {
      const [path, rest] = gap.evidence.split(' L');
      recommendations.push(`Update the file-size limit in ${fileName(path)} (line ${rest.split(':')[0]}) from ${sizeChange.before} to ${sizeChange.after}.`);
    }
  }
  if (formatChange?.added.length) {
    const codeGap = gaps.find((gap) => gap.artifactType === 'SOURCE_FILE' && /MIME/.test(gap.title));
    risks.push({ severity: 'MEDIUM', title: `${formatChange.added.join(', ')} support requires implementation and testing`,
      reason: codeGap ? `${formatChange.added.join(', ')} is missing from the MIME allow-list.` : 'New format must be accepted end-to-end.',
      evidence: codeGap?.evidence ?? 'Requirement adds a new accepted format.', confidence: codeGap ? 0.94 : 0.7, verificationStatus: codeGap ? 'VERIFIED' : 'UNVERIFIED' });
    if (codeGap) recommendations.push(`Add ${formatChange.added.map((f) => `image/${f.toLowerCase()}`).join(', ')} to the MIME allow-list in ${codeGap.key}.`);
  }
  if (formatChange?.removed.length) {
    risks.push({ severity: 'HIGH', title: `${formatChange.removed.join(', ')} may still be accepted`, reason: 'A format was removed from the requirement.',
      evidence: gaps.filter((gap) => /still accepted/.test(gap.title)).map((gap) => gap.evidence).join('\n') || 'Not confirmed in source.', confidence: 0.8, verificationStatus: 'UNVERIFIED' });
  }
  for (const change of quantityChanges) {
    const hits = impacts.filter((item) => item.artifactType === 'SOURCE_FILE' && item.verificationStatus !== 'UNVERIFIED');
    risks.push({ severity: 'HIGH', title: `Configured ${change.unit} limit may still be ${change.before}`, reason: `${key} now specifies ${change.after} ${change.unit}.`,
      evidence: hits.map((item) => `${item.key}: ${item.evidence.split('\n')[0]}`).join('\n') || 'No literal match in stored source.', confidence: hits.length ? 0.8 : 0.55, verificationStatus: hits.length ? 'REQUIRES_REVALIDATION' : 'UNVERIFIED' });
    if (hits.length) recommendations.push(`Update the ${change.unit} value from ${change.before} to ${change.after} in ${hits.map((item) => item.key).join(', ')}.`);
  }
  const testGaps = gaps.filter((gap) => gap.artifactType === 'TEST');
  if (testGaps.length || affectedTests.length) {
    risks.push({ severity: 'MEDIUM', title: 'Test suite does not yet assert the updated behaviour',
      reason: `${affectedTests.length} linked test file(s) assert the previous rules; ${testGaps.length} coverage gap(s) found.`,
      evidence: testGaps.map((gap) => gap.title).join('\n') || affectedTests.map((t) => t.path).join(', '), confidence: 0.9, verificationStatus: testGaps.length ? 'VERIFIED' : 'REQUIRES_REVALIDATION' });
  }
  if (!structured && changes.length) {
    risks.push({ severity: 'MEDIUM', title: `Linked implementation may not reflect the revised ${key}`, reason: 'Requirement wording or criteria changed without a measurable constraint.',
      evidence: changes.map((c) => c.label).join(', '), confidence: 0.6, verificationStatus: 'UNVERIFIED' });
  }
  gaps.filter((gap) => /Acceptance criterion \d+ still references/.test(gap.title))
    .forEach((gap) => recommendations.push(`Update ${gap.evidence.split(':')[0]} to reference ${formatSize(after.maxSize)}.`));
  if (sizeChange && after.maxSize) recommendations.push(`Update boundary tests: exactly ${sizeChange.after} is accepted and ${sizeChange.after} + 1 byte is rejected.`);
  if (formatChange?.added.length) recommendations.push(`Add a test asserting ${formatChange.added.join('/')} uploads are accepted.`);
  if (affectedTests.length) recommendations.push(`Re-run the affected test suite (${affectedTests.map((t) => t.path).join(', ')}).`);
  recommendations.push(`Revalidate ${key} once the implementation and tests are updated.`);

  const aiSuggestions = await aiAugment(requirement, previous, changes).catch(() => []);

  return {
    report: {
      fromVersion, toVersion, previous, current,
      changes: [
        ...changes,
        { dimension: 'CONSTRAINTS', label: 'Extracted constraints', before: describeConstraints(before), after: describeConstraints(after) }
      ],
      impacts: sortImpacts(impacts), gaps, risks, recommendations: unique(recommendations), unaffected, aiSuggestions,
      generatedBy: 'SYSTEM', status: 'OPEN'
    },
    findingUpdates
  };
}

function inspectFile(content, { before, after, sizeChange, formatChange, quantityChanges }) {
  const scan = inspectSource(content);
  const evidence = [];
  const reasons = [];
  const stale = sizeChange && before.maxSize ? scan.sizeRefs.filter((ref) => ref.bytes === before.maxSize && ref.bytes !== after.maxSize) : [];
  if (stale.length) { evidence.push(...stale); reasons.push(`Still enforces the previous ${sizeChange.before} limit.`); }
  const missingFormats = formatChange && scan.formatRefs.length ? formatChange.added.filter((format) => !scan.allFormats.includes(format)) : [];
  if (missingFormats.length) { evidence.push(scan.formatRefs[0]); reasons.push(`MIME allow-list lacks ${missingFormats.join(', ')}.`); }
  const stillAccepted = formatChange?.removed.length ? scan.formatRefs.filter((ref) => ref.formats.some((format) => formatChange.removed.includes(format))) : [];
  if (stillAccepted.length) { evidence.push(...stillAccepted); reasons.push(`Still accepts removed format(s) ${formatChange.removed.join(', ')}.`); }
  for (const change of quantityChanges ?? []) {
    const hits = typeof change.before === 'number' ? findLiteral(scan.lines, change.before) : [];
    if (hits.length) { evidence.push(...hits.slice(0, 2)); reasons.push(`Contains the previous ${change.unit} value ${change.before}.`); }
  }
  return { evidence: uniqueBy(evidence, (e) => e.line), reasons, stale, missingFormats, stillAccepted, formatRefs: scan.formatRefs, lineCount: scan.lines.length };
}

const uniqueBy = (items, keyOf) => items.filter((item, index) => items.findIndex((other) => keyOf(other) === keyOf(item)) === index);
const dimensionName = (dimension) => ({ MAX_FILE_SIZE: 'file-size', ALLOWED_FORMATS: 'file-type', QUANTITY: 'limit' })[dimension] ?? 'requirement';
const LEVEL_ORDER = { DIRECTLY_AFFECTED: 0, POTENTIALLY_AFFECTED: 1, REQUIRES_REVALIDATION: 2 };
const TYPE_ORDER = { TASK: 0, SOURCE_FILE: 1, TEST: 2, COMMIT: 3, PULL_REQUEST: 4, FINDING: 5 };
const sortImpacts = (items) => items.sort((a, b) => (TYPE_ORDER[a.artifactType] - TYPE_ORDER[b.artifactType]) || (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]));

async function aiAugment(requirement, previous, changes) {
  if (!isAiConfigured()) return [];
  const content = await completeChat([
    { role: 'system', content: 'You review requirement changes. Return JSON only: {"suggestions":["..."]} with at most 4 short, specific engineering risks or edge cases not already obvious. These are unverified suggestions.' },
    { role: 'user', content: JSON.stringify({ key: requirement.key, previous, current: { title: requirement.title, description: requirement.description, acceptanceCriteria: requirement.acceptanceCriteria }, changes }) }
  ], { json: true });
  const parsed = parseJsonResponse(content);
  return Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((item) => typeof item === 'string').slice(0, 4) : [];
}

export async function markFindingsForRevalidation(ids) {
  if (ids.length) await Finding.updateMany({ _id: { $in: ids } }, { $set: { verificationStatus: 'REQUIRES_REVALIDATION' } });
}
