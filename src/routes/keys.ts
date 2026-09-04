import { Hono } from "hono";
import { createApiKey, revokeApiKey, findApiKeyByRawKey } from "../db/api-keys.js";
import type { ApiError, Env } from "../types/arove.js";

export const keyRoutes = new Hono<{ Bindings: Env }>();

function errorResponse(status: number, error: string, message: string): ApiError {
  return { error, message, status };
}

keyRoutes.post("/", async (c) => {
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
