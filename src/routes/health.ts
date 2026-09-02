import { Hono } from "hono";
import { getRateLimit } from "../github/client.js";
import { countRegisteredRepos } from "../db/repos.js";
import type { Env } from "../types/arove.js";

export const healthRoutes = new Hono<{ Bindings: Env }>();

healthRoutes.get("/", async (c) => {
  const checks: Record<string, "ok" | "error"> = {
    kv: "ok",
    d1: "ok",
    github: "ok",
  };

  let githubRateLimit = null;
  let registeredRepoCount: number | null = null;

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
    githubRateLimit = await getRateLimit(c.env.GITHUB_TOKEN);
  } catch {
    checks.github = "error";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");

  return c.json(
    {
      status: allOk ? "healthy" : "degraded",
      checks,
      githubRateLimit,
      registeredRepoCount,
      timestamp: new Date().toISOString(),
    },
    allOk ? 200 : 503
  );
});
