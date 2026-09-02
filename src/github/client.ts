const GITHUB_API = "https://api.github.com";

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "arove/0.2.0 (+https://github.com/nullcats/arove)",
  };
}

export class GitHubApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function githubFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, { headers: headers(token) });
  if (!res.ok) {
    throw new GitHubApiError(res.status, `GitHub API ${res.status} for ${path}`);
  }
  if (res.status === 204) {
    return [] as unknown as T;
  }
  return res.json();
}

export interface GhRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  forks_count: number;
  subscribers_count?: number;
  watchers_count: number;
  open_issues_count: number;
  size: number;
  default_branch: string;
  has_issues: boolean;
  license: { spdx_id: string } | null;
  created_at: string;
  pushed_at: string;
}

export interface GhCommit {
  sha: string;
  commit: {
    message: string;
    author: { name?: string; date?: string } | null;
  };
  author: { login: string; avatar_url: string } | null;
  html_url: string;
  stats?: { additions: number; deletions: number };
}

export interface GhContributor {
  login: string;
  avatar_url: string;
  contributions: number;
}

export interface GhRelease {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
  html_url: string;
}

export async function getRepo(owner: string, name: string, token: string): Promise<GhRepo> {
  return githubFetch<GhRepo>(`/repos/${owner}/${name}`, token);
}

export async function getLanguages(
  owner: string,
  name: string,
  token: string
): Promise<Record<string, number>> {
  return githubFetch<Record<string, number>>(`/repos/${owner}/${name}/languages`, token);
}

export async function getCommits(
  owner: string,
  name: string,
  token: string,
  perPage = 10
): Promise<GhCommit[]> {
  return githubFetch<GhCommit[]>(
    `/repos/${owner}/${name}/commits?per_page=${perPage}`,
    token
  );
}

export async function getContributors(
  owner: string,
  name: string,
  token: string,
  perPage = 10
): Promise<GhContributor[]> {
  return githubFetch<GhContributor[]>(
    `/repos/${owner}/${name}/contributors?per_page=${perPage}`,
    token
  );
}

export async function getReleases(
  owner: string,
  name: string,
  token: string,
  perPage = 1
): Promise<GhRelease[]> {
  return githubFetch<GhRelease[]>(
    `/repos/${owner}/${name}/releases?per_page=${perPage}`,
    token
  );
}

export async function hasReadme(owner: string, name: string, token: string): Promise<boolean> {
  try {
    await githubFetch(`/repos/${owner}/${name}/readme`, token);
    return true;
  } catch {
    return false;
  }
}

export async function getOpenPullRequestCount(
  owner: string,
  name: string,
  token: string
): Promise<number> {
  try {
    const res = await githubFetch<{ total_count: number }>(
      `/search/issues?q=${encodeURIComponent(`repo:${owner}/${name} is:pr is:open`)}&per_page=1`,
      token
    );
    return res.total_count;
  } catch {
    return 0;
  }
}

export async function getRateLimit(token: string): Promise<{
  limit: number;
  remaining: number;
  resetAt: string;
}> {
  const res = await githubFetch<{
    resources: { core: { limit: number; remaining: number; reset: number } };
  }>("/rate_limit", token);
  const core = res.resources.core;
  return {
    limit: core.limit,
    remaining: core.remaining,
    resetAt: new Date(core.reset * 1000).toISOString(),
  };
}
