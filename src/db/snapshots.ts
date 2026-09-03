import type { LanguageBreakdown } from "../types/arove.js";

export interface SnapshotRow {
  id: number;
  repo_id: number;
  stars: number;
  forks: number;
  watchers: number;
  open_issues: number;
  open_pull_requests: number;
  language_breakdown: string;
  size_kb: number;
  default_branch: string;
  captured_at: string;
}

export interface InsertSnapshotInput {
  repoId: number;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  openPullRequests: number;
  languageBreakdown: LanguageBreakdown;
  sizeKb: number;
  defaultBranch: string;
}

export async function insertSnapshot(
  db: D1Database,
  input: InsertSnapshotInput
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO repo_snapshots
        (repo_id, stars, forks, watchers, open_issues, open_pull_requests, language_breakdown, size_kb, default_branch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.repoId,
      input.stars,
      input.forks,
      input.watchers,
      input.openIssues,
      input.openPullRequests,
      JSON.stringify(input.languageBreakdown),
      input.sizeKb,
      input.defaultBranch
    )
    .run();
}

export async function getLatestSnapshot(
  db: D1Database,
  repoId: number
): Promise<SnapshotRow | null> {
  const row = await db
    .prepare(
      "SELECT * FROM repo_snapshots WHERE repo_id = ? ORDER BY captured_at DESC LIMIT 1"
    )
    .bind(repoId)
    .first<SnapshotRow>();
  return row ?? null;
}

export async function getSnapshotHistory(
  db: D1Database,
  repoId: number,
  limit = 100,
  offset = 0
): Promise<SnapshotRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM repo_snapshots WHERE repo_id = ? ORDER BY captured_at DESC LIMIT ? OFFSET ?"
    )
    .bind(repoId, limit, offset)
    .all<SnapshotRow>();
  return result.results ?? [];
}

export async function countSnapshots(db: D1Database, repoId: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM repo_snapshots WHERE repo_id = ?")
    .bind(repoId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
