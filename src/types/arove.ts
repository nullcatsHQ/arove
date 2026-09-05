export interface RepoIdentity {
  owner: string;
  name: string;
  fullName: string;
  ownerAvatarUrl: string | null;
  ownerType: string | null;
}

export interface RepoStats {
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  openPullRequests: number;
  sizeKb: number;
  defaultBranch: string;
  isArchived: boolean;
  isFork: boolean;
  license: string | null;
  createdAt: string;
  pushedAt: string;
  updatedAt: string;
  description: string | null;
  homepage: string | null;
  topics: string[];
  visibility: string;
  networkCount: number;
}

export interface LanguageBreakdown {
  [language: string]: {
    bytes: number;
    percentage: number;
  };
}

export interface CommitSummary {
  sha: string;
  shortSha: string;
  message: string;
  authorLogin: string | null;
  authorName: string;
  authorAvatarUrl: string | null;
  committedAt: string;
  url: string;
}

export interface ContributorSummary {
  login: string;
  avatarUrl: string;
  contributions: number;
  profileUrl: string;
}

export interface ReleaseSummary {
  tagName: string;
  name: string | null;
  publishedAt: string | null;
  isPrerelease: boolean;
  isDraft: boolean;
  url: string;
}

export interface HealthSignals {
  hasReadme: boolean;
  hasLicense: boolean;
  hasIssuesEnabled: boolean;
  daysSinceLastCommit: number | null;
  daysSinceLastRelease: number | null;
  openIssueRatio: number | null;
}

export interface RepoSnapshot {
  repo: RepoIdentity;
  stats: RepoStats;
  languages: LanguageBreakdown;
  latestCommits: CommitSummary[];
  topContributors: ContributorSummary[];
  latestRelease: ReleaseSummary | null;
  health: HealthSignals;
  fetchedAt: string;
}

export interface RepoSnapshotCompact {
  repo: string;
  stars: number;
  forks: number;
  openIssues: number;
  lastCommitSha: string | null;
  lastCommitAt: string | null;
  fetchedAt: string;
}

export interface BranchSummary {
  name: string;
  commitSha: string;
  isProtected: boolean;
  isDefault: boolean;
}

export interface TagSummary {
  name: string;
  commitSha: string;
}

export interface IssueSummary {
  number: number;
  title: string;
  state: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  labels: string[];
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  baseBranch: string;
  headBranch: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export const AROVE_EVENT_TYPES = [
  "push",
  "star",
  "fork",
  "release",
  "issue",
  "pull_request",
] as const;

export type AroveEventType = (typeof AROVE_EVENT_TYPES)[number];

export interface AroveEvent<T = Record<string, unknown>> {
  type: "event";
  event: AroveEventType;
  data: T;
  ts: string;
}

export interface AroveHello {
  type: "hello";
  repo: string;
  snapshot: RepoSnapshot;
}

export interface ArovePing {
  type: "ping";
  ts: string;
}

export interface AroveSubscribed {
  type: "subscribed";
  repo: string;
  events: AroveEventType[] | "all";
}

export interface AroveWsError {
  type: "error";
  message: string;
}

export type AroveServerMessage =
  | AroveHello
  | AroveEvent
  | ArovePing
  | AroveSubscribed
  | AroveWsError;

export interface AroveClientPong {
  type: "pong";
}

export type AroveClientMessage = AroveClientPong;

export interface ApiError {
  error: string;
  message: string;
  status: number;
}

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  GITHUB_TOKEN: string;
  TOKEN_COUNT: string;
  POLL_INTERVAL_ACTIVE_MS: string;
  POLL_INTERVAL_IDLE_MS: string;
  SOCKET_CHECK_INTERVAL_MS: string;
  RATE_LIMIT_ANONYMOUS_PER_MINUTE: string;
  RATE_LIMIT_AUTHENTICATED_PER_MINUTE: string;
  [key: `GITHUB_TOKEN_${number}`]: string | undefined;
}
