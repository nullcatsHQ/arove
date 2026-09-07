import { sha256Hex, generateSecureToken } from "../lib/crypto.js";

export interface ApiKeyRow {
  id: number;
  key_hash: string;
  key_prefix: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  request_count: number;
  revoked_at: string | null;
}

const KEY_PREFIX = "arove_";

export interface CreatedApiKey {
  fullKey: string;
  prefix: string;
  id: number;
}

export async function createApiKey(
  db: D1Database,
  label: string | null
): Promise<CreatedApiKey> {
  const raw = generateSecureToken(24);
  const fullKey = `${KEY_PREFIX}${raw}`;
  const prefix = fullKey.slice(0, 12);
  const hash = await sha256Hex(fullKey);

  const result = await db
    .prepare("INSERT INTO api_keys (key_hash, key_prefix, label) VALUES (?, ?, ?)")
    .bind(hash, prefix, label)
    .run();

  const id = result.meta.last_row_id;
  return { fullKey, prefix, id };
}

export async function revokeApiKey(db: D1Database, keyId: number): Promise<void> {
  await db
    .prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?")
    .bind(keyId)
    .run();
}

const INACTIVITY_LIMIT_DAYS = 180;

export async function findApiKeyByRawKey(
  db: D1Database,
  rawKey: string
): Promise<ApiKeyRow | null> {
  const hash = await sha256Hex(rawKey);
  const row = await db
    .prepare("SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL")
    .bind(hash)
    .first<ApiKeyRow>();

  if (!row) return null;

  const lastActivity = row.last_used_at ?? row.created_at;
  const daysSinceActivity = (Date.now() - new Date(lastActivity).getTime()) / 86_400_000;

  if (daysSinceActivity > INACTIVITY_LIMIT_DAYS) {
    await revokeApiKey(db, row.id);
    return null;
  }

  return row;
}

export async function recordApiKeyUsage(db: D1Database, keyId: number): Promise<void> {
  await db
    .prepare(
      "UPDATE api_keys SET last_used_at = datetime('now'), request_count = request_count + 1 WHERE id = ?"
    )
    .bind(keyId)
    .run();
}

export async function listApiKeys(db: D1Database): Promise<ApiKeyRow[]> {
  const result = await db
    .prepare("SELECT * FROM api_keys ORDER BY created_at DESC")
    .all<ApiKeyRow>();
  return result.results ?? [];
}

export async function revokeStaleKeys(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE api_keys
       SET revoked_at = datetime('now')
       WHERE revoked_at IS NULL
       AND COALESCE(last_used_at, created_at) < datetime('now', '-${INACTIVITY_LIMIT_DAYS} days')`
    )
    .run();
  return result.meta.changes ?? 0;
}
