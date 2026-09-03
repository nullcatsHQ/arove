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

export async function findApiKeyByRawKey(
  db: D1Database,
  rawKey: string
): Promise<ApiKeyRow | null> {
  const hash = await sha256Hex(rawKey);
  const row = await db
    .prepare("SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL")
    .bind(hash)
    .first<ApiKeyRow>();
  return row ?? null;
}

export async function recordApiKeyUsage(db: D1Database, keyId: number): Promise<void> {
  await db
    .prepare(
      "UPDATE api_keys SET last_used_at = datetime('now'), request_count = request_count + 1 WHERE id = ?"
    )
    .bind(keyId)
    .run();
}

export async function revokeApiKey(db: D1Database, keyId: number): Promise<void> {
  await db
    .prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?")
    .bind(keyId)
    .run();
}

export async function listApiKeys(db: D1Database): Promise<ApiKeyRow[]> {
  const result = await db
    .prepare("SELECT * FROM api_keys ORDER BY created_at DESC")
    .all<ApiKeyRow>();
  return result.results ?? [];
}
