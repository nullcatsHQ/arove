const CACHE_PREFIX = "cache:";
const SUBSCRIBER_PREFIX = "subs:";
const VERSION_PREFIX = "ver:";
const DEFAULT_TTL_SECONDS = 60;
const VERSION_TTL_SECONDS = 120;

export async function getCachedSnapshot<T>(
  kv: KVNamespace,
  repoFullName: string
): Promise<T | null> {
  const raw = await kv.get(`${CACHE_PREFIX}${repoFullName}`, "json");
  return (raw as T) ?? null;
}

export async function setCachedSnapshot<T>(
  kv: KVNamespace,
  repoFullName: string,
  value: T,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<void> {
  await kv.put(`${CACHE_PREFIX}${repoFullName}`, JSON.stringify(value), {
    expirationTtl: ttlSeconds,
  });
}

export async function invalidateCachedSnapshot(
  kv: KVNamespace,
  repoFullName: string
): Promise<void> {
  await kv.delete(`${CACHE_PREFIX}${repoFullName}`);
}

export async function getSnapshotVersion(
  kv: KVNamespace,
  repoFullName: string
): Promise<number> {
  const raw = await kv.get(`${VERSION_PREFIX}${repoFullName}`);
  return raw ? Number(raw) || 0 : 0;
}

export async function bumpSnapshotVersion(
  kv: KVNamespace,
  repoFullName: string
): Promise<number> {
  const next = (await getSnapshotVersion(kv, repoFullName)) + 1;
  await kv.put(`${VERSION_PREFIX}${repoFullName}`, String(next), {
    expirationTtl: VERSION_TTL_SECONDS,
  });
  return next;
}

export async function getSubscriberCount(
  kv: KVNamespace,
  repoFullName: string
): Promise<number> {
  const raw = await kv.get(`${SUBSCRIBER_PREFIX}${repoFullName}`);
  return raw ? Number(raw) || 0 : 0;
}

export async function incrementSubscriberCount(
  kv: KVNamespace,
  repoFullName: string
): Promise<void> {
  const current = await getSubscriberCount(kv, repoFullName);
  await kv.put(`${SUBSCRIBER_PREFIX}${repoFullName}`, String(current + 1), {
    expirationTtl: 120,
  });
}

export async function decrementSubscriberCount(
  kv: KVNamespace,
  repoFullName: string
): Promise<void> {
  const current = await getSubscriberCount(kv, repoFullName);
  const next = Math.max(0, current - 1);
  if (next === 0) {
    await kv.delete(`${SUBSCRIBER_PREFIX}${repoFullName}`);
  } else {
    await kv.put(`${SUBSCRIBER_PREFIX}${repoFullName}`, String(next), {
      expirationTtl: 120,
    });
  }
}

const RATE_LIMIT_PREFIX = "rl:";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
}

export async function checkRateLimit(
  kv: KVNamespace,
  identifier: string,
  limitPerWindow: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const windowStart = Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds;
  const key = `${RATE_LIMIT_PREFIX}${identifier}:${windowStart}`;
  const resetAt = (windowStart + windowSeconds) * 1000;

  const raw = await kv.get(key);
  const current = raw ? Number(raw) || 0 : 0;

  if (current >= limitPerWindow) {
    return { allowed: false, remaining: 0, limit: limitPerWindow, resetAt };
  }

  await kv.put(key, String(current + 1), { expirationTtl: windowSeconds + 5 });

  return {
    allowed: true,
    remaining: limitPerWindow - current - 1,
    limit: limitPerWindow,
    resetAt,
  };
}
