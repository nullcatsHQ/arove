<h3 align="center">Bring your own database</h3>

<p align="center">
  Arove ships with one database and one cache because that's the free path and most people don't need anything else. But it's not glued to either one. This file exists to prove that.
</p>

<p align="center">
  <a href="#the-two-folders-that-matter">The two folders</a> •
  <a href="#the-contract-you-need-to-match">The contract</a> •
  <a href="#postgres-example">Postgres example</a> •
  <a href="#redis-example">Redis example</a> •
  <a href="#what-doesnt-need-to-change-at-all">What stays the same</a>
</p>

<br>

## The two folders that matter

```
src/db/       every database query, seven files
src/cache/    every cache operation, one file called kv.ts
```

That's it. That's the whole surface area. No route touches the database directly, no scheduled job reaches into the cache on its own, nothing does. Everything goes through these two folders and calls a named function. So if you want Postgres, Supabase, MySQL, Redis, whatever you already run and trust, you rewrite these files with the same function names and the same shapes, and the rest of the project keeps working like nothing happened.

I built it this way mostly out of habit, not because I planned ahead for this exact request. Turns out keeping storage in one lane makes swapping it out later a lot less painful than I expected.

<br>

## The contract you need to match

Below is every function called by name somewhere else in the codebase. Match the name, match the parameters, match the return type. What's inside the function is entirely up to you.

### src/db/repos.ts

```ts
findRepo(db, owner: string, name: string): Promise<RepoRow | null>
findRepoById(db, id: number): Promise<RepoRow | null>
registerRepo(db, owner: string, name: string): Promise<{ repo: RepoRow; wasCreated: boolean }>
markSynced(db, repoId: number): Promise<void>
markWebhookReceived(db, repoId: number): Promise<void>
listAllRegisteredRepos(db): Promise<RepoRow[]>
countRegisteredRepos(db): Promise<number>
regenerateWebhookSecret(db, repoId: number): Promise<string>
```

### src/db/commits.ts

```ts
upsertCommits(db, repoId: number, commits: CommitSummary[]): Promise<void>
getCommitHistory(db, repoId, limit?, since?, offset?): Promise<CommitRow[]>
countCommits(db, repoId: number): Promise<number>
getLatestKnownSha(db, repoId: number): Promise<string | null>
```

### src/db/snapshots.ts

```ts
insertSnapshot(db, input: InsertSnapshotInput): Promise<void>
getLatestSnapshot(db, repoId: number): Promise<SnapshotRow | null>
getSnapshotHistory(db, repoId, limit?, offset?): Promise<SnapshotRow[]>
countSnapshots(db, repoId: number): Promise<number>
```

### src/db/events.ts

```ts
insertEvent(db, repoId, eventType: AroveEventType, payload: Record<string, unknown>): Promise<void>
getRecentEvents(db, repoId, limit?, offset?, eventTypes?): Promise<EventRow[]>
countEvents(db, repoId, eventTypes?): Promise<number>
getEventsSince(db, repoId, sinceEventId: number, limit?): Promise<EventRow[]>
getLatestEventId(db, repoId: number): Promise<number>
getLatestReleaseTag(db, repoId: number): Promise<string | null>
```

### src/db/api-keys.ts

```ts
createApiKey(db, label: string | null): Promise<CreatedApiKey>
findApiKeyByRawKey(db, rawKey: string): Promise<ApiKeyRow | null>
recordApiKeyUsage(db, keyId: number): Promise<void>
revokeApiKey(db, keyId: number): Promise<void>
listApiKeys(db): Promise<ApiKeyRow[]>
```

### src/cache/kv.ts

```ts
getCachedSnapshot<T>(kv, key: string): Promise<T | null>
setCachedSnapshot<T>(kv, key: string, value: T, ttlSeconds?): Promise<void>
invalidateCachedSnapshot(kv, key: string): Promise<void>
getSnapshotVersion(kv, key: string): Promise<number>
bumpSnapshotVersion(kv, key: string): Promise<number>
getSubscriberCount(kv, key: string): Promise<number>
incrementSubscriberCount(kv, key: string): Promise<void>
decrementSubscriberCount(kv, key: string): Promise<void>
checkRateLimit(kv, identifier, limitPerWindow, windowSeconds): Promise<RateLimitResult>
isOnCooldown(kv, key: string): Promise<boolean>
startCooldown(kv, key: string, ttlSeconds: number): Promise<void>
wasAlreadyProcessed(kv, dedupeId: string): Promise<boolean>
markProcessed(kv, dedupeId: string, ttlSeconds: number): Promise<void>
healthCheckPing(kv): Promise<void>
getFlag(kv, key: string): Promise<boolean>
setFlag(kv, key: string, ttlSeconds: number): Promise<void>
getCounter(kv, key: string): Promise<number>
setCounter(kv, key: string, value: number, ttlSeconds: number): Promise<void>
```

The `RepoRow`, `CommitRow`, `EventRow`, `SnapshotRow`, `ApiKeyRow`, `CreatedApiKey`, `InsertSnapshotInput`, and `RateLimitResult` types all live next to whichever function actually uses them. Don't rename a field on any of these without checking who reads it, routes pull specific fields off these objects and they won't guess what you meant.

> [!TIP]
> Do `repos.ts` and `kv.ts` first. Nearly every request touches both of those, get them solid before you bother with the rest.

<br>

## What actually changes

Every one of those functions takes a database or cache handle as its first argument. Today that's whatever binding type your platform hands you. Swap it out and that first argument becomes whatever your own client gives you, a `postgres.js` connection, an `ioredis` client, a Supabase client, doesn't matter which. Nobody calling these functions cares what type that first argument is, TypeScript only checks that at the point where the function is defined, not everywhere it's used.

<br>

## Postgres example

`findRepo` and `registerRepo` from `repos.ts`, rebuilt against Postgres with `postgres.js`. Easier to just show it than explain it.

```ts
import postgres from "postgres";

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
  sql: postgres.Sql,
  owner: string,
  name: string
): Promise<RepoRow | null> {
  const rows = await sql<RepoRow[]>`
    SELECT * FROM repos WHERE owner = ${owner} AND name = ${name}
  `;
  return rows[0] ?? null;
}

export async function registerRepo(
  sql: postgres.Sql,
  owner: string,
  name: string
): Promise<{ repo: RepoRow; wasCreated: boolean }> {
  const existing = await findRepo(sql, owner, name);
  if (existing) return { repo: existing, wasCreated: false };

  const secret = generateWebhookSecret();
  const rows = await sql<RepoRow[]>`
    INSERT INTO repos (owner, name, webhook_secret)
    VALUES (${owner}, ${name}, ${secret})
    RETURNING *
  `;
  return { repo: rows[0], wasCreated: true };
}
```

You'll need to translate the schema too, same old SQLite to Postgres story. `INTEGER PRIMARY KEY AUTOINCREMENT` turns into `SERIAL PRIMARY KEY` or `GENERATED ALWAYS AS IDENTITY`, text timestamps turn into `TIMESTAMPTZ`, `datetime('now')` turns into `now()`. Everything that exists lives in `src/db/schema.sql`, that's the whole picture, nothing hidden elsewhere. Do that translation first, then move on to the functions.

<br>

## Redis example

```ts
import { Redis } from "@upstash/redis";

export async function getCachedSnapshot<T>(
  redis: Redis,
  key: string
): Promise<T | null> {
  const raw = await redis.get<T>(`cache:${key}`);
  return raw ?? null;
}

export async function setCachedSnapshot<T>(
  redis: Redis,
  key: string,
  value: T,
  ttlSeconds = 60
): Promise<void> {
  await redis.set(`cache:${key}`, JSON.stringify(value), { ex: ttlSeconds });
}
```

Same pattern the rest of the way through. `SET` with an expiry and a plain `GET` cover nearly every TTL based function in `kv.ts` without much thought. One thing worth calling out though, `incrementSubscriberCount` and `decrementSubscriberCount` are currently a read followed by a write, because a plain key value store doesn't give you an atomic increment. Redis does. `INCR` and `DECR` fix that outright, not a nice to have, an actual correctness improvement over what's there now.

<br>

## Wiring it into the entry point

The entry point pulls its database and cache handles off an environment object, and that object only exists because of the bindings declared in the config file. If you're running somewhere that doesn't work that way at all, a plain Node server for instance, build your clients at startup and hand them off through request context instead.

```ts
const sql = postgres(process.env.DATABASE_URL!);
const redis = new Redis({ url: process.env.REDIS_URL!, token: process.env.REDIS_TOKEN! });

app.use("*", async (c, next) => {
  c.set("db", sql);
  c.set("cache", redis);
  await next();
});
```

After that it's just find and replace across the route files, every place that referenced the old binding now references whatever you named it in context. The call shape doesn't move, only where the handle comes from.

<br>

## What doesn't need to change at all

- `src/github`, doesn't know what storage you're using and doesn't need to
- `src/routes`, only ever talks to storage through the contract above, never straight to a client
- `src/jobs/poll-stats.ts`, same deal
- `src/types/arove.ts`, the response shapes have nothing to do with any of this

The only two lines that actually need touching are in `Env`, inside `types/arove.ts`, where the database and cache fields are typed. Change those two once your replacement modules exist and TypeScript will hunt down every place that still expects the old shape. Watching that error list shrink to zero is oddly satisfying, not going to lie.

<br>

---

<p align="center">
  <sub>Part of Arove, by nullCats&trade;</sub>
</p>
