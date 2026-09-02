import {
  getRepo,
  getLanguages,
  getCommits,
  getContributors,
  getReleases,
  hasReadme,
  getOpenPullRequestCount,
  type GhCommit,
} from "./client.js";
import type {
  CommitSummary,
  ContributorSummary,
  HealthSignals,
  LanguageBreakdown,
  ReleaseSummary,
  RepoSnapshot,
  RepoStats,
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

export async function fetchRepoSnapshot(
  owner: string,
  name: string,
  token: string
): Promise<RepoSnapshot> {
  const [repoData, languagesRaw, commitsRaw, contributorsRaw, releasesRaw, readmeExists, openPrCount] =
    await Promise.all([
      getRepo(owner, name, token),
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
