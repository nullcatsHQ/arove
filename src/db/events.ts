import type { AroveEventType } from "../types/arove.js";

export interface EventRow {
  id: number;
  repo_id: number;
  event_type: AroveEventType;
  payload: string;
  detected_at: string;
}

export async function insertEvent(
  db: D1Database,
  repoId: number,
  eventType: AroveEventType,
  payload: Record<string, unknown>
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO events (repo_id, event_type, payload) VALUES (?, ?, ?)"
    )
    .bind(repoId, eventType, JSON.stringify(payload))
    .run();
}

export async function getRecentEvents(
  db: D1Database,
  repoId: number,
  limit = 50,
  offset = 0,
  eventTypes?: AroveEventType[]
): Promise<EventRow[]> {
  if (eventTypes && eventTypes.length > 0) {
    const placeholders = eventTypes.map(() => "?").join(",");
    const result = await db
      .prepare(
        `SELECT * FROM events WHERE repo_id = ? AND event_type IN (${placeholders}) ORDER BY detected_at DESC LIMIT ? OFFSET ?`
      )
      .bind(repoId, ...eventTypes, limit, offset)
      .all<EventRow>();
    return result.results ?? [];
  }

  const result = await db
    .prepare(
      "SELECT * FROM events WHERE repo_id = ? ORDER BY detected_at DESC LIMIT ? OFFSET ?"
    )
    .bind(repoId, limit, offset)
    .all<EventRow>();
  return result.results ?? [];
}

export async function countEvents(
  db: D1Database,
  repoId: number,
  eventTypes?: AroveEventType[]
): Promise<number> {
  if (eventTypes && eventTypes.length > 0) {
    const placeholders = eventTypes.map(() => "?").join(",");
    const row = await db
      .prepare(
        `SELECT COUNT(*) as count FROM events WHERE repo_id = ? AND event_type IN (${placeholders})`
      )
      .bind(repoId, ...eventTypes)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  const row = await db
    .prepare("SELECT COUNT(*) as count FROM events WHERE repo_id = ?")
    .bind(repoId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getEventsSince(
  db: D1Database,
  repoId: number,
  sinceEventId: number,
  limit = 50
): Promise<EventRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM events WHERE repo_id = ? AND id > ? ORDER BY id ASC LIMIT ?"
    )
    .bind(repoId, sinceEventId, limit)
    .all<EventRow>();
  return result.results ?? [];
}

export async function getLatestEventId(
  db: D1Database,
  repoId: number
): Promise<number> {
  const row = await db
    .prepare("SELECT MAX(id) as maxId FROM events WHERE repo_id = ?")
    .bind(repoId)
    .first<{ maxId: number | null }>();
  return row?.maxId ?? 0;
}

export async function getLatestReleaseTag(
  db: D1Database,
  repoId: number
): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT payload FROM events WHERE repo_id = ? AND event_type = 'release' ORDER BY detected_at DESC LIMIT 1"
    )
    .bind(repoId)
    .first<{ payload: string }>();

  if (!row) return null;

  try {
    const parsed = JSON.parse(row.payload) as { tag?: string };
    return parsed.tag ?? null;
  } catch {
    return null;
  }
}
