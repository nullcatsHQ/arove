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
  limit = 50
): Promise<EventRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM events WHERE repo_id = ? ORDER BY detected_at DESC LIMIT ?"
    )
    .bind(repoId, limit)
    .all<EventRow>();
  return result.results ?? [];
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
