import { fetchRepoSnapshot } from "../github/normalize.js";
import { setCachedSnapshot, getSubscriberCount, bumpSnapshotVersion } from "../cache/kv.js";
import { listAllRegisteredRepos, markSynced } from "../db/repos.js";
import { getLatestSnapshot, insertSnapshot, type SnapshotRow } from "../db/snapshots.js";
import { getLatestKnownSha, upsertCommits } from "../db/commits.js";
import { insertEvent, getLatestReleaseTag } from "../db/events.js";
import type { AroveEventType, Env, RepoSnapshot } from "../types/arove.js";

function parseIntervalMs(envValue: string | undefined, fallback: number): number {
  const parsed = Number(envValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function diffStats(
  previous: SnapshotRow | null,
  next: RepoSnapshot,
  newestKnownSha: string | null
): Array<{ type: AroveEventType; data: Record<string, unknown> }> {
  const events: Array<{ type: AroveEventType; data: Record<string, unknown> }> = [];

  if (previous) {
    if (next.stats.stars !== previous.stars) {
      events.push({ type: "star", data: { from: previous.stars, to: next.stats.stars } });
    }
    if (next.stats.forks !== previous.forks) {
      events.push({ type: "fork", data: { from: previous.forks, to: next.stats.forks } });
    }
    if (next.stats.openIssues !== previous.open_issues) {
      events.push({
        type: "issue",
        data: { from: previous.open_issues, to: next.stats.openIssues },
      });
    }
  }

  const latestCommit = next.latestCommits[0];
  if (latestCommit && latestCommit.sha !== newestKnownSha) {
    events.push({
      type: "push",
      data: {
        sha: latestCommit.sha,
        message: latestCommit.message,
        author: latestCommit.authorLogin ?? latestCommit.authorName,
      },
    });
  }

  return events;
}

export async function pollOneRepo(
  env: Env,
  owner: string,
  name: string,
  repoId: number
): Promise<void> {
  const fullName = `${owner}/${name}`;

  const [snapshot, previous, newestKnownSha, previousReleaseTag] = await Promise.all([
    fetchRepoSnapshot(owner, name, env.GITHUB_TOKEN),
    getLatestSnapshot(env.DB, repoId),
    getLatestKnownSha(env.DB, repoId),
    getLatestReleaseTag(env.DB, repoId),
  ]);

  const events = diffStats(previous, snapshot, newestKnownSha);

  const currentReleaseTag = snapshot.latestRelease?.tagName;
  if (currentReleaseTag && currentReleaseTag !== previousReleaseTag) {
    events.push({
      type: "release",
      data: {
        tag: currentReleaseTag,
        name: snapshot.latestRelease?.name,
        url: snapshot.latestRelease?.url,
      },
    });
  }

  await Promise.all([
    setCachedSnapshot(env.CACHE, fullName, snapshot),
    insertSnapshot(env.DB, {
      repoId,
      stars: snapshot.stats.stars,
      forks: snapshot.stats.forks,
      watchers: snapshot.stats.watchers,
      openIssues: snapshot.stats.openIssues,
      openPullRequests: snapshot.stats.openPullRequests,
      languageBreakdown: snapshot.languages,
      sizeKb: snapshot.stats.sizeKb,
      defaultBranch: snapshot.stats.defaultBranch,
    }),
    upsertCommits(env.DB, repoId, snapshot.latestCommits),
    markSynced(env.DB, repoId),
  ]);

  for (const event of events) {
    await insertEvent(env.DB, repoId, event.type, event.data);
  }

  if (events.length > 0) {
    await bumpSnapshotVersion(env.CACHE, fullName);
  }
}

export async function runPollTick(env: Env): Promise<void> {
  const activeInterval = parseIntervalMs(env.POLL_INTERVAL_ACTIVE_MS, 60_000);
  const idleInterval = parseIntervalMs(env.POLL_INTERVAL_IDLE_MS, 300_000);

  const repos = await listAllRegisteredRepos(env.DB);

  for (const repo of repos) {
    const fullName = `${repo.owner}/${repo.name}`;
    const subscriberCount = await getSubscriberCount(env.CACHE, fullName);
    const interval = subscriberCount > 0 ? activeInterval : idleInterval;

    const lastSyncedMs = repo.last_synced_at
      ? new Date(repo.last_synced_at).getTime()
      : 0;

    if (Date.now() - lastSyncedMs < interval) continue;

    try {
      await pollOneRepo(env, repo.owner, repo.name, repo.id);
    } catch (err) {
      console.error(`[poll] failed for ${fullName}:`, err);
    }
  }
}
