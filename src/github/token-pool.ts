import { getFlag, setFlag, getCounter, setCounter } from "../cache/kv.js";
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
  await setFlag(env.CACHE, `${EXHAUSTED_PREFIX}${tokenIndex}`, ttl);
}

async function isTokenExhausted(env: Env, tokenIndex: number): Promise<boolean> {
  return getFlag(env.CACHE, `${EXHAUSTED_PREFIX}${tokenIndex}`);
}

export async function pickToken(
  env: Env,
  skipIndexes: Set<number> = new Set()
): Promise<{ token: string; index: number }> {
  const tokens = getConfiguredTokens(env);

  if (tokens.length === 1) {
    return { token: tokens[0], index: 0 };
  }

  const start = await getCounter(env.CACHE, ROUND_ROBIN_KEY);

  for (let offset = 0; offset < tokens.length; offset++) {
    const index = (start + offset) % tokens.length;
    if (skipIndexes.has(index)) continue;
    const exhausted = await isTokenExhausted(env, index);
    if (!exhausted) {
      await setCounter(env.CACHE, ROUND_ROBIN_KEY, (index + 1) % tokens.length, 3600);
      return { token: tokens[index], index };
    }
  }

  // every token is either exhausted or already tried this request, just hand back the next one in line
  const fallbackIndex = start % tokens.length;
  return { token: tokens[fallbackIndex], index: fallbackIndex };
}

export function getTokenPoolSize(env: Env): number {
  return getConfiguredTokens(env).length;
}
