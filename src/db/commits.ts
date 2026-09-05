import type { CommitSummary } from "../types/arove.js";

export interface CommitRow {
  id: number;
  repo_id: number;
  sha: string;
  author_login: string | null;
  author_name: string | null;
  message: string | null;
  additions: number | null;
  deletions: number | null;
  committed_at: string | null;
}

export async function upsertCommits(
  db: D1Database,
  repoId: number,
  commits: CommitSummary[]
): Promise<void> {
  if (commits.length === 0) return;

  const statements = commits.map((c) =>
    db
      .prepare(
        `INSERT INTO commits (repo_id, sha, author_login, author_name, message, additions, deletions, committed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (repo_id, sha) DO UPDATE SET
           additions = COALESCE(commits.additions, excluded.additions),
           deletions = COALESCE(commits.deletions, excluded.deletions)`
      )
      .bind(
        repoId,
        c.sha,
        c.authorLogin,
        c.authorName,
        c.message,
        c.additions,
        c.deletions,
        c.committedAt
      )
  );

  await db.batch(statements);
}

export async function getCommitHistory(
  db: D1Database,
  repoId: number,
  limit = 50,
  since?: string,
  offset = 0
): Promise<CommitRow[]> {
  if (since) {
    const result = await db
      .prepare(
        "SELECT * FROM commits WHERE repo_id = ? AND committed_at >= ? ORDER BY committed_at DESC LIMIT ? OFFSET ?"
      )
      .bind(repoId, since, limit, offset)
      .all<CommitRow>();
    return result.results ?? [];
  }

  const result = await db
    .prepare("SELECT * FROM commits WHERE repo_id = ? ORDER BY committed_at DESC LIMIT ? OFFSET ?")
    .bind(repoId, limit, offset)
    .all<CommitRow>();
  return result.results ?? [];
}

export async function countCommits(db: D1Database, repoId: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM commits WHERE repo_id = ?")
    .bind(repoId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getLatestKnownSha(
  db: D1Database,
  repoId: number
): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT sha FROM commits WHERE repo_id = ? ORDER BY committed_at DESC LIMIT 1"
    )
    .bind(repoId)
    .first<{ sha: string }>();
  return row?.sha ?? null;
}
