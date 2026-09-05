<h3 align="center">Bring your own database</h3>

<p align="center">
  Arove ships with one database and one cache out of the box because that's the free path for most people. Nothing about how it actually works depends on that specific setup though, and this file is here to prove it.
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

Every database call and every cache call in this whole project goes through exactly two places.

```
src/db/       all database queries, seven files
src/cache/    all cache operations, one file called kv.ts
```

No route, no scheduled job, no middleware ever touches the database or cache directly. They only ever call the named functions exported from these two spots. So swapping to Postgres, Supabase, MySQL, Redis, or whatever you'd rather run is really just a matter of rewriting these specific files with the same function names and the same shapes. Nothing else in the codebase needs to know or care.

<br>

## The contract you need to match

Every function listed below gets called by name somewhere else in the project. Match the name, the parameters, and the return type, and use whatever client library your database or cache actually needs under the hood.

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

Every `RepoRow`, `CommitRow`, `EventRow`, `SnapshotRow`, `ApiKeyRow`, `CreatedApiKey`, `InsertSnapshotInput`, and `RateLimitResult` type lives in the same file as the functions that use it. Keep those shapes identical too, routes destructure specific fields off them and won't forgive a renamed field.

> [!TIP]
> Start with `src/db/repos.ts` and `src/cache/kv.ts` first. Those two get exercised by nearly every request, so getting them right early saves you from chasing errors across the whole file list later.

<br>

## What actually changes

Every function above takes a database or cache handle as its first argument. Right now that's typed as whatever binding your platform hands you. Swap providers and that first parameter's type changes to whatever your client library gives you instead, a `postgres.js` `Sql` instance, an `ioredis` client, a Supabase client, anything at all. Every call site elsewhere just passes the handle through without caring what type it actually is, TypeScript only checks the shape at the point of definition.

<br>

## Postgres example

Here's `findRepo` and `registerRepo` from `repos.ts` rebuilt against Postgres with `postgres.js`, just to show the real shape of the swap instead of describing it in the abstract.

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

The schema needs the usual SQLite to Postgres translation too. `INTEGER PRIMARY KEY AUTOINCREMENT` becomes `SERIAL PRIMARY KEY` or `GENERATED ALWAYS AS IDENTITY`, text timestamps become `TIMESTAMPTZ`, and `datetime('now')` becomes `now()`. `src/db/schema.sql` and the files under `src/db/migrations` are the full source of truth for every table and column that exists. Translate those first, then translate the functions.

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

The rest of the file follows the same pattern. Redis's `SET` with an expiry and a plain `GET` map directly onto every TTL based function in `kv.ts`. Honestly, `incrementSubscriberCount` and `decrementSubscriberCount` would even get better on Redis, real `INCR` and `DECR` instead of the read then write dance a plain key value store forces on you. That's not a hypothetical, it's a genuine correctness upgrade if you go this route.

<br>

## Wiring it into the entry point

The entry point reads its database and cache handles off an environment object that only exists because of the bindings declared in the config file. Deploying somewhere that doesn't use that pattern at all, say a plain Node server? Construct your database and cache clients directly at startup and pass them through request context instead.

```ts
const sql = postgres(process.env.DATABASE_URL!);
const redis = new Redis({ url: process.env.REDIS_URL!, token: process.env.REDIS_TOKEN! });

app.use("*", async (c, next) => {
  c.set("db", sql);
  c.set("cache", redis);
  await next();
});
```

Every route's reference to the database binding becomes a reference to whatever you named it in context, same for the cache. It's a mechanical find and replace across the route files once the storage layer itself is rebuilt, the call shape never changes, only where the handle actually comes from.

<br>

## What doesn't need to change at all

- `src/github`, the GitHub API client and token pool don't know or care what storage you're using
- `src/routes`, every route calls the storage layer through its function contract, never the client underneath it
- `src/jobs/poll-stats.ts`, same story, calls through the contract
- `src/types/arove.ts`, the public API response shapes have nothing to do with storage

The `Env` type in `types/arove.ts` currently types the database and cache fields as your platform's specific binding types. Update just those two lines to your own client types once the replacement modules exist, and TypeScript will point out every single spot the contract doesn't line up. It's genuinely a good feeling watching that list shrink to zero.

<br>

---

<p align="center">
  <sub>Part of Arove, by nullCats&trade;</sub>
</p>
