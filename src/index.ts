import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";
import { repoRoutes, batchRoutes } from "./routes/repo.js";
import { healthRoutes } from "./routes/health.js";
import { webhookRoutes } from "./routes/webhook.js";
import { keyRoutes } from "./routes/keys.js";
import { openapiRoutes } from "./routes/openapi.js";
import { rateLimitAndAuth } from "./middleware/auth.js";
import { runPollTick } from "./jobs/poll-stats.js";
import type { ApiError, Env } from "./types/arove.js";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "If-None-Match",
      "Authorization",
      "X-Hub-Signature-256",
      "X-GitHub-Event",
    ],
    exposeHeaders: ["ETag", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
    maxAge: 600,
  })
);

app.get("/", (c) =>
  c.json({
    name: "arove",
    description: "Open-source, edge-optimized heartbeat API for GitHub repositories.",
    docs: "https://github.com/nullcats/arove",
    endpoints: {
      snapshot: "GET /v1/repo/:owner/:name",
      live: "WS /v1/repo/:owner/:name",
      commits: "GET /v1/repo/:owner/:name/commits",
      stats: "GET /v1/repo/:owner/:name/stats",
      events: "GET /v1/repo/:owner/:name/events",
      languages: "GET /v1/repo/:owner/:name/languages",
      contributors: "GET /v1/repo/:owner/:name/contributors",
      releases: "GET /v1/repo/:owner/:name/releases",
      branches: "GET /v1/repo/:owner/:name/branches",
      tags: "GET /v1/repo/:owner/:name/tags",
      issues: "GET /v1/repo/:owner/:name/issues",
      pulls: "GET /v1/repo/:owner/:name/pulls",
      badge: "GET /v1/repo/:owner/:name/badge",
      register: "POST /v1/repo/:owner/:name/register",
      refresh: "POST /v1/repo/:owner/:name/refresh",
      webhookStatus: "GET /v1/repo/:owner/:name/webhook",
      webhookRegenerate: "POST /v1/repo/:owner/:name/webhook",
      batch: "GET /v1/repos?repos=owner/name,owner2/name2",
      createApiKey: "POST /v1/keys",
      revokeApiKey: "POST /v1/keys/revoke",
      openapi: "GET /v1/openapi.json",
      health: "GET /v1/health",
    },
    rateLimits: {
      anonymous: "30 requests/minute per IP",
      authenticated: "300 requests/minute per API key",
      note: "Create a free key at POST /v1/keys for a 10x higher limit.",
    },
  })
);

app.use("/v1/repo/*", rateLimitAndAuth());
app.use("/v1/repos", rateLimitAndAuth());

app.route("/v1/repo", repoRoutes);
app.route("/v1/repos", batchRoutes);
app.route("/v1/health", healthRoutes);
app.route("/v1/webhook", webhookRoutes);
app.route("/v1/keys", keyRoutes);
app.route("/v1/openapi.json", openapiRoutes);

app.notFound((c) => c.json({ error: "not_found", message: "No such route.", status: 404 }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const body: ApiError = {
      error: "http_exception",
      message: err.message || "Request could not be processed.",
      status: err.status,
    };
    return c.json(body, err.status);
  }

  console.error(`[unhandled] ${c.req.method} ${c.req.path}:`, err);

  const body: ApiError = {
    error: "internal_error",
    message: "Something went wrong processing this request.",
    status: 500,
  };
  return c.json(body, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runPollTick(env));
  },
};
