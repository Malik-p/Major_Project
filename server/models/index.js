import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/* ─── User ──────────────────────────────────────────────────────────────── */
const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true }
}, { timestamps: true });

/* ─── Project ───────────────────────────────────────────────────────────── */
const projectSchema = new Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  repository: {
    owner: { type: String, default: '' },
    name: { type: String, default: '' },
    url: { type: String, default: '' }
  },
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
  isDemo: { type: Boolean, default: false }
}, { timestamps: true });

/* ─── Requirement ───────────────────────────────────────────────────────── */
const requirementSchema = new Schema({
  key: { type: String, required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  type: { type: String, enum: ['FUNCTIONAL', 'NON_FUNCTIONAL', 'SECURITY', 'PERFORMANCE', 'USABILITY'], default: 'FUNCTIONAL' },
  priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'MEDIUM' },
  status: { type: String, enum: ['DRAFT', 'ANALYZED', 'READY', 'IN_PROGRESS', 'IMPLEMENTED', 'VERIFIED', 'CHANGED', 'DONE', 'AT_RISK'], default: 'DRAFT' },
  acceptanceCriteria: [{ type: String }],
  owner: { type: String, default: '' },
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  revision: { type: Number, default: 1 },
  changedAt: Date
}, { timestamps: true });
requirementSchema.index({ project: 1, key: 1 }, { unique: true });
requirementSchema.index({ project: 1, status: 1 });

/* ─── Requirement Version (change history) ──────────────────────────────── */
const requirementVersionSchema = new Schema({
  requirement: { type: Schema.Types.ObjectId, ref: 'Requirement', required: true, index: true },
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  version: { type: Number, required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  type: { type: String, default: 'FUNCTIONAL' },
  priority: { type: String, default: 'MEDIUM' },
  status: { type: String, default: 'DRAFT' },
  acceptanceCriteria: [{ type: String }],
  changeSummary: { type: String, default: '' },
  changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  impactStatus: { type: String, enum: ['PENDING', 'ANALYZED', 'RESOLVED'], default: 'PENDING' }
}, { timestamps: true });
requirementVersionSchema.index({ requirement: 1, version: 1 }, { unique: true });

/* ─── Task ──────────────────────────────────────────────────────────────── */
const taskSchema = new Schema({
  key: { type: String, required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  status: { type: String, enum: ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'BLOCKED'], default: 'TODO' },
  priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'MEDIUM' },
  assignee: { type: String, default: '' },
  estimate: { type: String, default: '' },
  dueDate: Date,
  sprint: { type: String, default: '' },
  dependencies: [{ type: String }],
  requirement: { type: Schema.Types.ObjectId, ref: 'Requirement', required: true, index: true },
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true }
}, { timestamps: true });
taskSchema.index({ project: 1, key: 1 }, { unique: true });
taskSchema.index({ project: 1, status: 1 });

/* ─── Sprint ────────────────────────────────────────────────────────────── */
const sprintSchema = new Schema({
  name: { type: String, required: true },
  goal: { type: String, default: '' },
  status: { type: String, enum: ['PLANNED', 'ACTIVE', 'COMPLETED'], default: 'PLANNED' },
  startsAt: Date,
  endsAt: Date,
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true }
}, { timestamps: true });

/* ─── Linked Artifact (shared base) ─────────────────────────────────────── */
const linkedArtifactSchema = (fields) => new Schema({
  ...fields,
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  requirement: { type: Schema.Types.ObjectId, ref: 'Requirement', index: true },
  task: { type: Schema.Types.ObjectId, ref: 'Task' },
  isDemo: { type: Boolean, default: false }
}, { timestamps: true });

const commitSchema = linkedArtifactSchema({
  sha: { type: String, required: true },
  message: { type: String, required: true },
  author: String,
  committedAt: Date,
  url: String,
  files: [String],
  additions: Number,
  deletions: Number
});

const pullRequestSchema = linkedArtifactSchema({
  number: Number,
  title: String,
  state: String,
  url: String,
  author: String,
  mergedAt: Date,
  changedFiles: [String]
});

const sourceFileSchema = linkedArtifactSchema({
  path: { type: String, required: true },
  language: String,
  summary: String,
  content: { type: String, default: '' },
  lastAnalyzedAt: Date
});

const testSchema = linkedArtifactSchema({
  name: { type: String, required: true },
  path: String,
  status: { type: String, enum: ['PASSING', 'FAILING', 'UNKNOWN'], default: 'UNKNOWN' },
  lastRunAt: Date,
  content: { type: String, default: '' }
});

const findingSchema = linkedArtifactSchema({
  key: { type: String, default: '' },
  title: { type: String, required: true },
  severity: { type: String, enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'], default: 'MEDIUM' },
  category: String,
  description: String,
  evidence: String,
  confidence: Number,
  verificationStatus: { type: String, enum: ['VERIFIED', 'AI_SUGGESTION', 'UNVERIFIED', 'REQUIRES_REVALIDATION'], default: 'UNVERIFIED' },
  status: { type: String, enum: ['OPEN', 'RESOLVED'], default: 'OPEN' },
  source: { type: String, default: 'REVIEW' },
  filePath: String
});

/* ─── Traceability Link ─────────────────────────────────────────────────── */
const traceabilityLinkSchema = new Schema({
  requirement: { type: Schema.Types.ObjectId, ref: 'Requirement', required: true },
  artifactType: { type: String, enum: ['TASK', 'COMMIT', 'PULL_REQUEST', 'SOURCE_FILE', 'TEST', 'FINDING'], required: true },
  artifact: { type: Schema.Types.ObjectId, required: true },
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true }
}, { timestamps: true });
traceabilityLinkSchema.index({ requirement: 1, artifactType: 1, artifact: 1 }, { unique: true });
traceabilityLinkSchema.index({ project: 1, requirement: 1 });

/* ─── Impact Analysis ───────────────────────────────────────────────────── */
const impactItemSchema = new Schema({
  level: String,
  artifactType: String,
  artifact: Schema.Types.ObjectId,
  key: String,
  title: String,
  reason: String,
  evidence: String,
  confidence: { type: Number, default: 0 },
  verificationStatus: { type: String, default: 'UNVERIFIED' }
}, { _id: false });

const impactAnalysisSchema = new Schema({
  requirement: { type: Schema.Types.ObjectId, ref: 'Requirement', required: true },
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  fromVersion: Number,
  toVersion: Number,
  previous: Schema.Types.Mixed,
  current: Schema.Types.Mixed,
  changes: [Schema.Types.Mixed],
  impacts: [impactItemSchema],
  gaps: [impactItemSchema],
  risks: [{ _id: false, severity: String, title: String, reason: String, evidence: String, confidence: Number, verificationStatus: String }],
  recommendations: [String],
  unaffected: [impactItemSchema],
  aiSuggestions: [String],
  status: { type: String, enum: ['OPEN', 'RESOLVED', 'SUPERSEDED'], default: 'OPEN' },
  resolvedAt: Date,
  generatedBy: { type: String, enum: ['SYSTEM', 'AI'], default: 'SYSTEM' }
}, { timestamps: true });
impactAnalysisSchema.index({ project: 1, requirement: 1 });

/* ─── Activity ──────────────────────────────────────────────────────────── */
const activitySchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  type: { type: String, required: true },
  message: { type: String, required: true },
  actor: { type: String, default: '' },
  at: { type: Date, default: Date.now }
});
activitySchema.index({ project: 1, at: -1 });

/* ─── Exports ───────────────────────────────────────────────────────────── */
export const User = model('User', userSchema);
export const Project = model('Project', projectSchema);
export const Requirement = model('Requirement', requirementSchema);
export const RequirementVersion = model('RequirementVersion', requirementVersionSchema);
export const Task = model('Task', taskSchema);
export const Sprint = model('Sprint', sprintSchema);
export const Commit = model('Commit', commitSchema);
export const PullRequest = model('PullRequest', pullRequestSchema);
export const SourceFile = model('SourceFile', sourceFileSchema);
export const Test = model('Test', testSchema);
export const Finding = model('Finding', findingSchema);
export const TraceabilityLink = model('TraceabilityLink', traceabilityLinkSchema);
export const ImpactAnalysis = model('ImpactAnalysis', impactAnalysisSchema);
export const Activity = model('Activity', activitySchema);
