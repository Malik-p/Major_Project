import { inspectSource, requirementConstraints } from './impact.js';

const formatSize = (bytes) => `${+(bytes / 1024 / 1024).toFixed(2)} MB`;

/**
 * Deterministic reviewer. Requirement-constraint mismatches are line-cited facts about the
 * submitted code (VERIFIED); security heuristics are pattern matches (UNVERIFIED).
 */
export function reviewSource(filePath, sourceCode, requirement) {
  const findings = [];
  const scan = inspectSource(sourceCode);
  const lineOf = (pattern) => scan.lines.findIndex((line) => pattern.test(line)) + 1;
  const at = (line) => `${filePath} L${line}: ${scan.lines[line - 1].trim()}`;

  if (requirement) {
    const constraints = requirementConstraints(requirement);
    const sizeMismatch = constraints.maxSize ? scan.sizeRefs.find((ref) => ref.bytes > constraints.maxSize && !/1024\s*\+\s*1/.test(ref.text) && /max|limit|size|smaller|larger/i.test(ref.text)) : null;
    if (sizeMismatch) {
      findings.push({
        title: `File-size limit ${formatSize(sizeMismatch.bytes)} exceeds the ${formatSize(constraints.maxSize)} required by ${requirement.key}`,
        severity: 'HIGH', category: 'VALIDATION',
        description: `${requirement.key} allows at most ${formatSize(constraints.maxSize)}, but the code permits larger files.`,
        evidence: at(sizeMismatch.line), confidence: 0.95, verificationStatus: 'VERIFIED'
      });
    }
    if (constraints.formats.length && scan.formatRefs.length) {
      const missing = constraints.formats.filter((format) => !scan.allFormats.includes(format));
      if (missing.length) {
        findings.push({
          title: `${missing.join(', ')} not accepted although ${requirement.key} requires it`,
          severity: 'MEDIUM', category: 'VALIDATION',
          description: `${requirement.key} accepts ${constraints.formats.join(', ')}; the allow-list only contains ${scan.allFormats.join(', ')}.`,
          evidence: at(scan.formatRefs[0].line), confidence: 0.94, verificationStatus: 'VERIFIED'
        });
      }
      const extra = scan.allFormats.filter((format) => !constraints.formats.includes(format));
      if (extra.length) {
        findings.push({
          title: `${extra.join(', ')} accepted but not permitted by ${requirement.key}`,
          severity: 'MEDIUM', category: 'VALIDATION', description: 'The allow-list accepts formats outside the requirement.',
          evidence: at(scan.formatRefs[0].line), confidence: 0.9, verificationStatus: 'VERIFIED'
        });
      }
    }
  }

  const regexLine = lineOf(/\$regex\s*:\s*(req\.(query|body|params)|query\b|term\b|q\b)/i);
  if (regexLine && !/escape/i.test(sourceCode)) {
    findings.push({ title: 'Unescaped user input in MongoDB $regex query', severity: 'HIGH', category: 'SECURITY',
      description: 'User-controlled input reaches a $regex query without escaping, enabling ReDoS or broad matches.', evidence: at(regexLine), confidence: 0.85, verificationStatus: 'UNVERIFIED' });
  }
  const randomLine = lineOf(/Math\.random\(\)/);
  if (randomLine && /token|reference|secret|id|code/i.test(scan.lines[randomLine - 1])) {
    findings.push({ title: 'Predictable value generated with Math.random()', severity: 'MEDIUM', category: 'SECURITY',
      description: 'Math.random() is not cryptographically secure; use crypto.randomBytes() or crypto.randomUUID().', evidence: at(randomLine), confidence: 0.85, verificationStatus: 'UNVERIFIED' });
  }
  const amountLine = lineOf(/amount\s*:\s*req\.body/);
  if (amountLine) {
    findings.push({ title: 'Charge amount trusted from the client', severity: 'CRITICAL', category: 'SECURITY',
      description: 'The amount to charge comes from the request body; compute it from the stored order instead.', evidence: at(amountLine), confidence: 0.9, verificationStatus: 'UNVERIFIED' });
  }
  const passwordLine = lineOf(/password\s*:\s*req\.body\.password/i);
  if (passwordLine && !/bcrypt|argon|hash/i.test(sourceCode)) {
    findings.push({ title: 'Password stored without hashing', severity: 'CRITICAL', category: 'SECURITY',
      description: 'The request password is persisted directly; hash it with bcrypt or argon2.', evidence: at(passwordLine), confidence: 0.9, verificationStatus: 'UNVERIFIED' });
  }
  const pageSizeLine = lineOf(/pageSize\s*=\s*Number\(req\.query/);
  if (pageSizeLine && !/Math\.min/.test(scan.lines[pageSizeLine - 1])) {
    findings.push({ title: 'Page size taken from the query string without an upper bound', severity: 'MEDIUM', category: 'VALIDATION',
      description: 'Clients can request arbitrarily large pages; clamp pageSize with Math.min().', evidence: at(pageSizeLine), confidence: 0.85, verificationStatus: 'UNVERIFIED' });
  }
  return findings;
}
