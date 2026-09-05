import {
  getRepo,
  getLanguages,
  getCommits,
  getCommitWithStats,
  getContributors,
  getReleases,
  hasReadme,
  getOpenPullRequestCount,
  getBranches,
  getTags,
  getIssues,
  getPullRequests,
  type GhCommit,
  type GhBranch,
  type GhTag,
  type GhIssue,
  type GhPullRequest,
} from "./client.js";
import type {
  BranchSummary,
  CommitSummary,
  ContributorSummary,
  Env,
  HealthSignals,
  IssueSummary,
  LanguageBreakdown,
  PullRequestSummary,
  ReleaseSummary,
  RepoSnapshot,
  RepoStats,
  TagSummary,
} from "../types/arove.js";

const daysSince = (iso: string | null): number | null => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
};

function normalizeLanguages(raw: Record<string, number>): LanguageBreakdown {
  const total = Object.values(raw).reduce((sum, bytes) => sum + bytes, 0);
  const result: LanguageBreakdown = {};
  for (const [lang, bytes] of Object.entries(raw)) {
    result[lang] = {
      bytes,
      percentage: total > 0 ? Math.round((bytes / total) * 10000) / 100 : 0,
    };
  }
  return result;
}

function sanitizeGitText(input: string): string {
  return input
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .trim();
}

function normalizeCommit(raw: GhCommit): CommitSummary {
  const rawMessage = raw.commit.message.split("\n")[0] ?? "";
  const rawAuthorName = raw.commit.author?.name ?? "unknown";

  return {
    sha: raw.sha,
    shortSha: raw.sha.slice(0, 7),
    message: sanitizeGitText(rawMessage),
    authorLogin: raw.author?.login ?? null,
    authorName: sanitizeGitText(rawAuthorName) || "unknown",
    authorAvatarUrl: raw.author?.avatar_url ?? null,
    additions: raw.stats?.additions ?? null,
    deletions: raw.stats?.deletions ?? null,
    committedAt: raw.commit.author?.date ?? new Date(0).toISOString(),
    url: raw.html_url,
  };
}

export class PrivateRepoError extends Error {
  constructor(owner: string, name: string) {
    super(`${owner}/${name} is private.`);
  }
}

export async function fetchRepoSnapshot(
  env: Env,
  owner: string,
  name: string
): Promise<RepoSnapshot> {
  const repoData = await getRepo(env, owner, name);

  if (repoData.private) {
    throw new PrivateRepoError(owner, name);
  }

  const [languagesRaw, commitsRaw, contributorsRaw, releasesRaw, readmeExists, openPrCount] =
    await Promise.all([
      getLanguages(env, owner, name),
      getCommits(env, owner, name, 10),
      getContributors(env, owner, name, 10),
      getReleases(env, owner, name, 1),
      hasReadme(env, owner, name),
      getOpenPullRequestCount(env, owner, name),
    ]);

  const stats: RepoStats = {
    stars: repoData.stargazers_count ?? 0,
    forks: repoData.forks_count ?? 0,
    watchers: repoData.subscribers_count ?? repoData.watchers_count ?? 0,
    openIssues: repoData.open_issues_count ?? 0,
    openPullRequests: openPrCount,
    sizeKb: repoData.size ?? 0,
    defaultBranch: repoData.default_branch ?? "main",
    isArchived: repoData.archived ?? false,
    isFork: repoData.fork ?? false,
    license: repoData.license?.spdx_id ?? null,
    createdAt: repoData.created_at ?? new Date(0).toISOString(),
    pushedAt: repoData.pushed_at ?? new Date(0).toISOString(),
    updatedAt: repoData.updated_at ?? new Date(0).toISOString(),
    description: repoData.description ? sanitizeGitText(repoData.description) : null,
    homepage: repoData.homepage ?? null,
    topics: repoData.topics ?? [],
    visibility: repoData.visibility ?? (repoData.private ? "private" : "public"),
    networkCount: repoData.network_count ?? repoData.forks_count ?? 0,
  };

  const latestCommits = commitsRaw.map(normalizeCommit);

  const latestSha = commitsRaw[0]?.sha;
  if (latestSha) {
    try {
      const detailed = await getCommitWithStats(env, owner, name, latestSha);
      if (detailed.stats) {
        latestCommits[0] = {
          ...latestCommits[0],
          additions: detailed.stats.additions,
          deletions: detailed.stats.deletions,
        };
      }
    } catch (err) {
      console.error(`[normalize] failed to fetch latest commit stats for ${owner}/${name}:`, err);
    }
  }

  const topContributors: ContributorSummary[] = contributorsRaw
    .filter((c) => Boolean(c.login && c.avatar_url))
    .map((c) => ({
      login: c.login,
      avatarUrl: c.avatar_url,
      contributions: c.contributions,
      profileUrl: `https://github.com/${c.login}`,
    }));

  const latestReleaseRaw = releasesRaw[0] ?? null;
  const latestRelease: ReleaseSummary | null = latestReleaseRaw
    ? {
        tagName: latestReleaseRaw.tag_name,
        name: latestReleaseRaw.name ? sanitizeGitText(latestReleaseRaw.name) : null,
        publishedAt: latestReleaseRaw.published_at,
        isPrerelease: latestReleaseRaw.prerelease,
        isDraft: latestReleaseRaw.draft,
        url: latestReleaseRaw.html_url,
      }
    : null;

  const health: HealthSignals = {
    hasReadme: readmeExists,
    hasLicense: repoData.license !== null,
    hasIssuesEnabled: repoData.has_issues ?? false,
    daysSinceLastCommit: daysSince(repoData.pushed_at),
    daysSinceLastRelease: daysSince(latestRelease?.publishedAt ?? null),
    openIssueRatio: null,
  };

  return {
    repo: {
      owner,
      name,
      fullName: `${owner}/${name}`,
      ownerAvatarUrl: repoData.owner?.avatar_url ?? null,
      ownerType: repoData.owner?.type ?? null,
    },
    stats,
    languages: normalizeLanguages(languagesRaw),
    latestCommits,
    topContributors,
    latestRelease,
    health,
    fetchedAt: new Date().toISOString(),
  };
}

function normalizeBranch(raw: GhBranch, defaultBranch: string): BranchSummary {
  return {
    name: raw.name,
    commitSha: raw.commit.sha,
    isProtected: raw.protected,
    isDefault: raw.name === defaultBranch,
  };
}

function normalizeTag(raw: GhTag): TagSummary {
  return { name: raw.name, commitSha: raw.commit.sha };
}

function normalizeIssue(raw: GhIssue): IssueSummary {
  return {
    number: raw.number,
    title: sanitizeGitText(raw.title),
    state: raw.state,
    authorLogin: raw.user?.login ?? null,
    authorAvatarUrl: raw.user?.avatar_url ?? null,
    labels: raw.labels.map((l) => (typeof l === "string" ? l : l.name)),
    commentCount: raw.comments,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    url: raw.html_url,
  };
}

function normalizePullRequest(raw: GhPullRequest): PullRequestSummary {
  return {
    number: raw.number,
    title: sanitizeGitText(raw.title),
    state: raw.state,
    isDraft: raw.draft,
    authorLogin: raw.user?.login ?? null,
    authorAvatarUrl: raw.user?.avatar_url ?? null,
    baseBranch: raw.base.ref,
    headBranch: raw.head.ref,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    url: raw.html_url,
  };
}

export async function fetchBranches(
  env: Env,
  owner: string,
  name: string
): Promise<BranchSummary[]> {
  const repoData = await getRepo(env, owner, name);
  if (repoData.private) throw new PrivateRepoError(owner, name);

  const branches = await getBranches(env, owner, name, 100);
  return branches.map((b) => normalizeBranch(b, repoData.default_branch));
}

export async function fetchTags(env: Env, owner: string, name: string): Promise<TagSummary[]> {
  const repoData = await getRepo(env, owner, name);
  if (repoData.private) throw new PrivateRepoError(owner, name);

  const tags = await getTags(env, owner, name, 100);
  return tags.map(normalizeTag);
}

export async function fetchIssues(
  env: Env,
  owner: string,
  name: string,
  state: "open" | "closed" | "all" = "open"
): Promise<IssueSummary[]> {
  const repoData = await getRepo(env, owner, name);
  if (repoData.private) throw new PrivateRepoError(owner, name);

  const issues = await getIssues(env, owner, name, 30, state);
  return issues.map(normalizeIssue);
}

export async function fetchPullRequests(
  env: Env,
  owner: string,
  name: string,
  state: "open" | "closed" | "all" = "open"
): Promise<PullRequestSummary[]> {
  const repoData = await getRepo(env, owner, name);
  if (repoData.private) throw new PrivateRepoError(owner, name);

  const pulls = await getPullRequests(env, owner, name, 30, state);
  return pulls.map(normalizePullRequest);
}
