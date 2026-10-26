import { Commit, Finding, PullRequest, SourceFile, Task, Test, TraceabilityLink } from '../models/index.js';

export const artifactModels = {
  TASK: Task, COMMIT: Commit, PULL_REQUEST: PullRequest,
  SOURCE_FILE: SourceFile, TEST: Test, FINDING: Finding
};

/** Loads every artifact linked to a requirement, via persistent links plus direct requirement references. */
export async function loadLinkedArtifacts(requirementId) {
  const links = await TraceabilityLink.find({ requirement: requirementId }).lean();
  const artifacts = {};
  await Promise.all(Object.entries(artifactModels).map(async ([type, Artifact]) => {
    const ids = links.filter((link) => link.artifactType === type).map((link) => link.artifact);
    artifacts[type] = await Artifact.find({ $or: [{ _id: { $in: ids } }, { requirement: requirementId }] }).lean();
  }));
  artifacts.TASK.sort((a, b) => a.key.localeCompare(b.key));
  artifacts.COMMIT.sort((a, b) => new Date(a.committedAt) - new Date(b.committedAt));
  return { artifacts, links };
}

export async function addLink(requirement, artifactType, artifact, project) {
  await TraceabilityLink.updateOne(
    { requirement, artifactType, artifact },
    { $setOnInsert: { requirement, artifactType, artifact, project } },
    { upsert: true }
  );
}

/** Next sequential key (REQ-011, TASK-031…) based on the highest existing number, so deletions never cause collisions. */
export async function nextKey(Model, project, prefix) {
  const items = await Model.find({ project, key: new RegExp(`^${prefix}-\\d+$`) }).select('key').lean();
  const max = items.reduce((highest, item) => Math.max(highest, Number(item.key.split('-')[1]) || 0), 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}
