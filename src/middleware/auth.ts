import type { Context, Next } from "hono";
import { findApiKeyByRawKey, recordApiKeyUsage } from "../db/api-keys.js";
import { checkRateLimit } from "../cache/kv.js";
import type { ApiError, Env } from "../types/arove.js";

const WINDOW_SECONDS = 60;

function parseLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface AuthState {
  authenticated: boolean;
  apiKeyId: number | null;
}

function errorResponse(status: number, error: string, message: string): ApiError {
  return { error, message, status };
}

export function rateLimitAndAuth() {
  return async (c: Context<{ Bindings: Env; Variables: { auth: AuthState } }>, next: Next) => {
    const anonymousLimit = parseLimit(c.env.RATE_LIMIT_ANONYMOUS_PER_MINUTE, 30);
    const authenticatedLimit = parseLimit(c.env.RATE_LIMIT_AUTHENTICATED_PER_MINUTE, 300);

    const authHeader = c.req.header("authorization");
    const rawKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    let identifier = c.req.header("cf-connecting-ip") ?? "unknown";
    let limit = anonymousLimit;
    let auth: AuthState = { authenticated: false, apiKeyId: null };

    if (rawKey) {
      const keyRow = await findApiKeyByRawKey(c.env.DB, rawKey);
      if (!keyRow) {
        return c.json(
          errorResponse(401, "invalid_api_key", "The provided API key is invalid or has been revoked."),
          401
        );
      }
      identifier = `key:${keyRow.id}`;
      limit = authenticatedLimit;
      auth = { authenticated: true, apiKeyId: keyRow.id };
      void recordApiKeyUsage(c.env.DB, keyRow.id);
    }

    const result = await checkRateLimit(c.env.CACHE, identifier, limit, WINDOW_SECONDS);

    c.header("X-RateLimit-Limit", String(result.limit));
    c.header("X-RateLimit-Remaining", String(result.remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      return c.json(
        errorResponse(
          429,
          "rate_limited",
          auth.authenticated
            ? "Rate limit exceeded for this API key."
            : "Rate limit exceeded. Provide an API key for a higher limit (see /v1/keys)."
        ),
        429
      );
    }

    c.set("auth", auth);
    await next();
  };
}
