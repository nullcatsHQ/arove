import { Hono } from "hono";
import { getTokenPoolSize } from "../github/token-pool.js";
import { countRegisteredRepos, checkCommitsSchema } from "../db/repos.js";
import { healthCheckPing } from "../cache/kv.js";
import type { Env } from "../types/arove.js";

export const healthRoutes = new Hono<{ Bindings: Env }>();

healthRoutes.get("/", async (c) => {
  const checks: Record<string, "ok" | "error"> = {
    kv: "ok",
    d1: "ok",
    github: "ok",
    schema: "ok",
  };

  let registeredRepoCount: number | null = null;
  let tokenPoolSize = 0;
  let missingColumns: string[] = [];

  try {
    await healthCheckPing(c.env.CACHE);
  } catch {
    checks.kv = "error";
  }

  try {
    registeredRepoCount = await countRegisteredRepos(c.env.DB);
  } catch {
    checks.d1 = "error";
  }

  try {
    const schemaCheck = await checkCommitsSchema(c.env.DB);
    if (!schemaCheck.ok) {
      checks.schema = "error";
      missingColumns = schemaCheck.missing;
    }
  } catch {
    checks.schema = "error";
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
      missingColumns: missingColumns.length > 0 ? missingColumns : undefined,
      tokenPoolConfigured: tokenPoolSize > 0,
      registeredRepoCount,
      timestamp: new Date().toISOString(),
    },
    allOk ? 200 : 503
  );
});
