import { Hono } from "hono";
import { createApiKey, revokeApiKey, findApiKeyByRawKey } from "../db/api-keys.js";
import { checkRateLimit } from "../cache/kv.js";
import type { ApiError, Env } from "../types/arove.js";

export const keyRoutes = new Hono<{ Bindings: Env }>();

const KEY_CREATION_LIMIT_PER_HOUR = 5;
const KEY_CREATION_WINDOW_SECONDS = 3600;

function errorResponse(status: number, error: string, message: string): ApiError {
  return { error, message, status };
}

keyRoutes.post("/", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const result = await checkRateLimit(
    c.env.CACHE,
    `key-creation:${ip}`,
    KEY_CREATION_LIMIT_PER_HOUR,
    KEY_CREATION_WINDOW_SECONDS
  );

  c.header("X-RateLimit-Limit", String(result.limit));
  c.header("X-RateLimit-Remaining", String(result.remaining));
  c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

  if (!result.allowed) {
    return c.json(
      errorResponse(429, "rate_limited", "Too many keys created recently from this address. Try again later."),
      429
    );
  }

  let label: string | null = null;
  try {
    const body = await c.req.json<{ label?: string }>();
    label = typeof body.label === "string" ? body.label.slice(0, 100) : null;
  } catch {}

  const created = await createApiKey(c.env.DB, label);

  return c.json(
    {
      created: true,
      key: created.fullKey,
      prefix: created.prefix,
      note:
        "Save this key now, it will not be shown again. Use it as a Bearer token: " +
        "'Authorization: Bearer <key>'. Authenticated requests get a higher rate limit.",
    },
    201
  );
});

keyRoutes.post("/revoke", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const result = await checkRateLimit(
    c.env.CACHE,
    `key-revoke:${ip}`,
    KEY_CREATION_LIMIT_PER_HOUR,
    KEY_CREATION_WINDOW_SECONDS
  );

  if (!result.allowed) {
    return c.json(
      errorResponse(429, "rate_limited", "Too many revoke attempts recently from this address. Try again later."),
      429
    );
  }

  const authHeader = c.req.header("authorization");
  const rawKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!rawKey) {
    return c.json(
      errorResponse(400, "missing_key", "Provide the key to revoke as a Bearer token."),
      400
    );
  }

  const keyRow = await findApiKeyByRawKey(c.env.DB, rawKey);
  if (!keyRow) {
    return c.json(errorResponse(404, "key_not_found", "No active key matches that value."), 404);
  }

  await revokeApiKey(c.env.DB, keyRow.id);
  return c.json({ revoked: true });
});
