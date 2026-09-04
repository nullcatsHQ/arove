import type { Env } from "../types/arove.js";

function getConfiguredTokens(env: Env): string[] {
  const count = Math.max(1, Math.min(50, Number(env.TOKEN_COUNT) || 1));
  const tokens: string[] = [];

  for (let i = 1; i <= count; i++) {
    const value = i === 1 ? env.GITHUB_TOKEN : env[`GITHUB_TOKEN_${i}`];
    if (value) tokens.push(value);
  }

  if (tokens.length === 0) {
    throw new Error(
      "No GitHub tokens configured. Set GITHUB_TOKEN as a secret (and optionally " +
        "GITHUB_TOKEN_2, GITHUB_TOKEN_3, ... up to TOKEN_COUNT)."
    );
  }

  return tokens;
}

const EXHAUSTED_PREFIX = "token-exhausted:";
const ROUND_ROBIN_KEY = "token-rr-index";

export async function markTokenExhausted(
  env: Env,
  tokenIndex: number,
  resetAtEpochSeconds: number
): Promise<void> {
  const ttl = Math.max(5, resetAtEpochSeconds - Math.floor(Date.now() / 1000));
  await env.CACHE.put(`${EXHAUSTED_PREFIX}${tokenIndex}`, "1", { expirationTtl: ttl });
}

async function isTokenExhausted(env: Env, tokenIndex: number): Promise<boolean> {
  const value = await env.CACHE.get(`${EXHAUSTED_PREFIX}${tokenIndex}`);
  return value !== null;
}

export async function pickToken(env: Env): Promise<{ token: string; index: number }> {
  const tokens = getConfiguredTokens(env);

  if (tokens.length === 1) {
    return { token: tokens[0], index: 0 };
  }

  const rawStart = await env.CACHE.get(ROUND_ROBIN_KEY);
  const start = rawStart ? Number(rawStart) || 0 : 0;

  for (let offset = 0; offset < tokens.length; offset++) {
    const index = (start + offset) % tokens.length;
    const exhausted = await isTokenExhausted(env, index);
    if (!exhausted) {
      await env.CACHE.put(ROUND_ROBIN_KEY, String((index + 1) % tokens.length), {
        expirationTtl: 3600,
      });
      return { token: tokens[index], index };
    }
  }

  return { token: tokens[start % tokens.length], index: start % tokens.length };
}

export function getTokenPoolSize(env: Env): number {
  return getConfiguredTokens(env).length;
}
