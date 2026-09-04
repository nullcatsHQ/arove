import { pickToken, markTokenExhausted } from "./token-pool.js";
import type { Env } from "../types/arove.js";

const GITHUB_API = "https://api.github.com";

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "arove/0.3.0 (+https://github.com/nullcats/arove)",
  };
}

export class GitHubApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isRateLimitResponse(res: Response): boolean {
  if (res.status === 429) return true;
  if (res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    return remaining === "0";
  }
  return false;
}

async function githubFetch<T>(env: Env, path: string): Promise<T> {
  const maxAttempts = 3;
  let lastError: GitHubApiError | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { token, index } = await pickToken(env);
    const res = await fetch(`${GITHUB_API}${path}`, { headers: headers(token) });

    if (isRateLimitResponse(res)) {
      const resetHeader = res.headers.get("x-ratelimit-reset");
      const resetAt = resetHeader ? Number(resetHeader) : Math.floor(Date.now() / 1000) + 60;
      await markTokenExhausted(env, index, resetAt);
      lastError = new GitHubApiError(res.status, `Rate limited on token ${index} for ${path}`);
      continue;
    }

    if (!res.ok) {
      throw new GitHubApiError(res.status, `GitHub API ${res.status} for ${path}`);
    }

    if (res.status === 204) {
      return [] as unknown as T;
    }

    return res.json();
  }

  throw lastError ?? new GitHubApiError(429, `All configured tokens are rate limited for ${path}`);
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
  homepage: string | null;
  description: string | null;
  topics?: string[];
  visibility?: string;
  network_count?: number;
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

export async function getRepo(env: Env, owner: string, name: string): Promise<GhRepo> {
  return githubFetch<GhRepo>(env, `/repos/${owner}/${name}`);
}

export async function getLanguages(
  env: Env,
  owner: string,
  name: string
): Promise<Record<string, number>> {
  return githubFetch<Record<string, number>>(env, `/repos/${owner}/${name}/languages`);
}

export async function getCommits(
  env: Env,
  owner: string,
  name: string,
  perPage = 10
): Promise<GhCommit[]> {
  return githubFetch<GhCommit[]>(env, `/repos/${owner}/${name}/commits?per_page=${perPage}`);
}

export async function getContributors(
  env: Env,
  owner: string,
  name: string,
  perPage = 10
): Promise<GhContributor[]> {
  return githubFetch<GhContributor[]>(
    env,
    `/repos/${owner}/${name}/contributors?per_page=${perPage}`
  );
}

export async function getReleases(
  env: Env,
  owner: string,
  name: string,
  perPage = 1
): Promise<GhRelease[]> {
  return githubFetch<GhRelease[]>(env, `/repos/${owner}/${name}/releases?per_page=${perPage}`);
}

export async function hasReadme(env: Env, owner: string, name: string): Promise<boolean> {
  try {
    await githubFetch(env, `/repos/${owner}/${name}/readme`);
    return true;
  } catch {
    return false;
  }
}

export async function getOpenPullRequestCount(
  env: Env,
  owner: string,
  name: string
): Promise<number> {
  try {
    const res = await githubFetch<{ total_count: number }>(
      env,
      `/search/issues?q=${encodeURIComponent(`repo:${owner}/${name} is:pr is:open`)}&per_page=1`
    );
    return res.total_count;
  } catch {
    return 0;
  }
}

export interface GhBranch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

export interface GhTag {
  name: string;
  commit: { sha: string };
}

export interface GhIssue {
  number: number;
  title: string;
  state: string;
  user: { login: string; avatar_url: string } | null;
  labels: Array<{ name: string; color: string } | string>;
  comments: number;
  created_at: string;
  updated_at: string;
  html_url: string;
  pull_request?: unknown;
}

export interface GhPullRequest {
  number: number;
  title: string;
  state: string;
  user: { login: string; avatar_url: string } | null;
  draft: boolean;
  created_at: string;
  updated_at: string;
  html_url: string;
  base: { ref: string };
  head: { ref: string };
}

export async function getBranches(
  env: Env,
  owner: string,
  name: string,
  perPage = 30
): Promise<GhBranch[]> {
  return githubFetch<GhBranch[]>(env, `/repos/${owner}/${name}/branches?per_page=${perPage}`);
}

export async function getTags(
  env: Env,
  owner: string,
  name: string,
  perPage = 30
): Promise<GhTag[]> {
  return githubFetch<GhTag[]>(env, `/repos/${owner}/${name}/tags?per_page=${perPage}`);
}

export async function getIssues(
  env: Env,
  owner: string,
  name: string,
  perPage = 30,
  state: "open" | "closed" | "all" = "open"
): Promise<GhIssue[]> {
  const all = await githubFetch<GhIssue[]>(
    env,
    `/repos/${owner}/${name}/issues?per_page=${perPage}&state=${state}`
  );
  return all.filter((issue) => !issue.pull_request);
}

export async function getPullRequests(
  env: Env,
  owner: string,
  name: string,
  perPage = 30,
  state: "open" | "closed" | "all" = "open"
): Promise<GhPullRequest[]> {
  return githubFetch<GhPullRequest[]>(
    env,
    `/repos/${owner}/${name}/pulls?per_page=${perPage}&state=${state}`
  );
}

export async function getRateLimitForToken(token: string): Promise<{
  limit: number;
  remaining: number;
  resetAt: string;
}> {
  const res = await fetch(`${GITHUB_API}/rate_limit`, { headers: headers(token) });
  if (!res.ok) {
    throw new GitHubApiError(res.status, "Failed to fetch rate limit status");
  }
  const data = (await res.json()) as {
    resources: { core: { limit: number; remaining: number; reset: number } };
  };
  const core = data.resources.core;
  return {
    limit: core.limit,
    remaining: core.remaining,
    resetAt: new Date(core.reset * 1000).toISOString(),
  };
}
