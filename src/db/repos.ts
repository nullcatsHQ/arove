import { generateWebhookSecret } from "../github/webhook.js";

export interface RepoRow {
  id: number;
  owner: string;
  name: string;
  created_at: string;
  last_synced_at: string | null;
  webhook_secret: string | null;
  last_webhook_at: string | null;
}

export async function findRepo(
  db: D1Database,
  owner: string,
  name: string
): Promise<RepoRow | null> {
  const row = await db
    .prepare("SELECT * FROM repos WHERE owner = ? AND name = ?")
    .bind(owner, name)
    .first<RepoRow>();
  return row ?? null;
}

export async function findRepoById(db: D1Database, id: number): Promise<RepoRow | null> {
  const row = await db
    .prepare("SELECT * FROM repos WHERE id = ?")
    .bind(id)
    .first<RepoRow>();
  return row ?? null;
}

export async function registerRepo(
  db: D1Database,
  owner: string,
  name: string
): Promise<{ repo: RepoRow; wasCreated: boolean }> {
  const existing = await findRepo(db, owner, name);
  if (existing) return { repo: existing, wasCreated: false };

  const secret = generateWebhookSecret();

  await db
    .prepare("INSERT INTO repos (owner, name, webhook_secret) VALUES (?, ?, ?)")
    .bind(owner, name, secret)
    .run();

  const created = await findRepo(db, owner, name);
  if (!created) throw new Error("Failed to read back newly registered repo.");
  return { repo: created, wasCreated: true };
}

export async function markSynced(db: D1Database, repoId: number): Promise<void> {
  await db
    .prepare("UPDATE repos SET last_synced_at = datetime('now') WHERE id = ?")
    .bind(repoId)
    .run();
}

export async function markWebhookReceived(db: D1Database, repoId: number): Promise<void> {
  await db
    .prepare("UPDATE repos SET last_webhook_at = datetime('now') WHERE id = ?")
    .bind(repoId)
    .run();
}

export async function listAllRegisteredRepos(db: D1Database): Promise<RepoRow[]> {
  const result = await db.prepare("SELECT * FROM repos").all<RepoRow>();
  return result.results ?? [];
}

export async function countRegisteredRepos(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM repos")
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function regenerateWebhookSecret(db: D1Database, repoId: number): Promise<string> {
  const secret = generateWebhookSecret();
  await db
    .prepare("UPDATE repos SET webhook_secret = ? WHERE id = ?")
    .bind(secret, repoId)
    .run();
  return secret;
}
