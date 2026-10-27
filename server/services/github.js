import { Commit, PullRequest, Requirement, SourceFile, Task } from '../models/index.js';
import { fail } from '../utils/errors.js';
import { addLink as link } from './traceability.js';

async function githubRequest(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'DevIntel'
    },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw fail(response.status === 404 ? 404 : 502, `GitHub API returned ${response.status}: ${detail.slice(0, 240)}`);
  }
  return response.json();
}

export async function syncRepository(project) {
  if (!process.env.GITHUB_TOKEN) throw fail(400, 'Set GITHUB_TOKEN in .env to enable live GitHub synchronisation');

  const { owner, name } = project.repository ?? {};
  if (!owner || !name) throw fail(400, 'Set the repository owner and name before syncing GitHub');
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const [repo, recentCommits, recentPullRequests, requirements, tasks] = await Promise.all([
    githubRequest(repoPath),
    githubRequest(`${repoPath}/commits?per_page=10`),
    githubRequest(`${repoPath}/pulls?state=all&per_page=10`),
    Requirement.find({ project: project.id }),
    Task.find({ project: project.id })
  ]);
  const matchArtifact = (text) => {
    const normalized = String(text ?? '').toLowerCase();
    const requirement = requirements.find((item) => normalized.includes(item.key.toLowerCase()));
    const task = tasks.find((item) => normalized.includes(item.key.toLowerCase()));
    return { requirement: requirement ?? (task ? requirements.find((item) => String(item.id) === String(task.requirement)) : null), task };
  };

  let syncedCommits = 0;
  for (const item of recentCommits.slice(0, 10)) {
    const details = await githubRequest(`${repoPath}/commits/${encodeURIComponent(item.sha)}`);
    const message = item.commit?.message ?? '';
    const links = matchArtifact(message);
    const files = (details.files ?? []).map((file) => file.filename);
    const commit = await Commit.findOneAndUpdate(
      { project: project.id, sha: item.sha },
      {
        $set: {
          message, author: item.author?.login ?? item.commit?.author?.name ?? 'Unknown',
          committedAt: item.commit?.author?.date ? new Date(item.commit.author.date) : undefined,
          url: item.html_url, files, isDemo: false,
          requirement: links.requirement?.id, task: links.task?.id
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (links.requirement) {
      await link(links.requirement.id, 'COMMIT', commit.id, project.id);
      for (const path of files) await saveFile(project, links.requirement, links.task, path);
    }
    syncedCommits += 1;
  }

  let syncedPullRequests = 0;
  for (const item of recentPullRequests.slice(0, 10)) {
    const links = matchArtifact(`${item.title}\n${item.body ?? ''}`);
    const files = await githubRequest(`${repoPath}/pulls/${item.number}/files?per_page=100`);
    const changedFiles = files.map((file) => file.filename);
    const pullRequest = await PullRequest.findOneAndUpdate(
      { project: project.id, number: item.number },
      {
        $set: {
          title: item.title, state: item.state === 'closed' ? (item.merged_at ? 'merged' : 'closed') : 'open',
          url: item.html_url, changedFiles, isDemo: false,
          requirement: links.requirement?.id, task: links.task?.id
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (links.requirement) {
      await link(links.requirement.id, 'PULL_REQUEST', pullRequest.id, project.id);
      for (const path of changedFiles) await saveFile(project, links.requirement, links.task, path);
    }
    syncedPullRequests += 1;
  }
  project.repository.url = repo.html_url;
  await project.save();
  return { repository: { fullName: repo.full_name, private: repo.private, defaultBranch: repo.default_branch, url: repo.html_url }, syncedCommits, syncedPullRequests };
}

async function saveFile(project, requirement, task, path) {
  const file = await SourceFile.findOneAndUpdate(
    { project: project.id, requirement: requirement.id, path },
    { $set: { task: task?.id, isDemo: false } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await link(requirement.id, 'SOURCE_FILE', file.id, project.id);
}

