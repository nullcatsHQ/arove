import {
  getRepo,
  getLanguages,
  getCommits,
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

function normalizeCommit(raw: GhCommit): CommitSummary {
  return {
    sha: raw.sha,
    shortSha: raw.sha.slice(0, 7),
    message: raw.commit.message.split("\n")[0] ?? "",
    authorLogin: raw.author?.login ?? null,
    authorName: raw.commit.author?.name ?? "unknown",
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
  owner: string,
  name: string,
  token: string
): Promise<RepoSnapshot> {
  const repoData = await getRepo(owner, name, token);

  if (repoData.private) {
    throw new PrivateRepoError(owner, name);
  }

  const [languagesRaw, commitsRaw, contributorsRaw, releasesRaw, readmeExists, openPrCount] =
    await Promise.all([
      getLanguages(owner, name, token),
      getCommits(owner, name, token, 10),
      getContributors(owner, name, token, 10),
      getReleases(owner, name, token, 1),
      hasReadme(owner, name, token),
      getOpenPullRequestCount(owner, name, token),
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
  };

  const latestCommits = commitsRaw.map(normalizeCommit);

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
        name: latestReleaseRaw.name,
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
    repo: { owner, name, fullName: `${owner}/${name}` },
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
    title: raw.title,
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
    title: raw.title,
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
  owner: string,
  name: string,
  token: string
): Promise<BranchSummary[]> {
  const repoData = await getRepo(owner, name, token);
  if (repoData.private) throw new PrivateRepoError(owner, name);

  const branches = await getBranches(owner, name, token, 100);
  return branches.map((b) => normalizeBranch(b, repoData.default_branch));
}

export async function fetchTags(
  owner: string,
  name: string,
  token: string
): Promise<TagSummary[]> {
  const repoData = await getRepo(owner, name, token);
  if (repoData.private) throw new PrivateRepoError(owner, name);

  const tags = await getTags(owner, name, token, 100);
  return tags.map(normalizeTag);
}

export async function fetchIssues(
  owner: string,
  name: string,
  token: string,
  state: "open" | "closed" | "all" = "open"
): Promise<IssueSummary[]> {
  const repoData = await getRepo(owner, name, token);
  if (repoData.private) throw new PrivateRepoError(owner, name);

  const issues = await getIssues(owner, name, token, 30, state);
  return issues.map(normalizeIssue);
}

export async function fetchPullRequests(
  owner: string,
  name: string,
  token: string,
  state: "open" | "closed" | "all" = "open"
): Promise<PullRequestSummary[]> {
  const repoData = await getRepo(owner, name, token);
  if (repoData.private) throw new PrivateRepoError(owner, name);

  const pulls = await getPullRequests(owner, name, token, 30, state);
  return pulls.map(normalizePullRequest);
}
