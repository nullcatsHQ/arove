const CACHE_PREFIX = "cache:";
const SUBSCRIBER_PREFIX = "subs:";
const DEFAULT_TTL_SECONDS = 60;

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
