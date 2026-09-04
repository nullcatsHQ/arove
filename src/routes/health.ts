import { Hono } from "hono";
import { getTokenPoolSize } from "../github/token-pool.js";
import { countRegisteredRepos } from "../db/repos.js";
import type { Env } from "../types/arove.js";

export const healthRoutes = new Hono<{ Bindings: Env }>();

healthRoutes.get("/", async (c) => {
  const checks: Record<string, "ok" | "error"> = {
    kv: "ok",
    d1: "ok",
    github: "ok",
  };

  let registeredRepoCount: number | null = null;
  let tokenPoolSize = 0;

  try {
    await c.env.CACHE.put("health:ping", "1", { expirationTtl: 60 });
  } catch {
    checks.kv = "error";
  }

  try {
    registeredRepoCount = await countRegisteredRepos(c.env.DB);
  } catch {
    checks.d1 = "error";
  }

  try {
    tokenPoolSize = getTokenPoolSize(c.env);
  } catch {
    checks.github = "error";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");

  return c.json(
    {
      status: allOk ? "healthy" : "degraded",
      checks,
      tokenPoolConfigured: tokenPoolSize > 0,
      registeredRepoCount,
      timestamp: new Date().toISOString(),
    },
    allOk ? 200 : 503
  );
});
