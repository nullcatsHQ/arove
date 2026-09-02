export interface RepoIdentity {
  owner: string;
  name: string;
  fullName: string;
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
  additions: number | null;
  deletions: number | null;
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
  POLL_INTERVAL_ACTIVE_MS: string;
  POLL_INTERVAL_IDLE_MS: string;
  SOCKET_CHECK_INTERVAL_MS: string;
}
