import { Hono } from "hono";
import type { Env } from "../types/arove.js";

export const openapiRoutes = new Hono<{ Bindings: Env }>();

openapiRoutes.get("/", (c) => {
  const baseUrl = new URL(c.req.url).origin;

  const spec = {
    openapi: "3.0.3",
    info: {
      title: "Arove API",
      description:
        "Open-source, edge-optimized REST + WebSocket heartbeat for GitHub repositories.",
      version: "0.3.0",
      license: { name: "MIT" },
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/v1/repo/{owner}/{name}": {
        get: {
          summary: "Get a repository snapshot",
          description:
            "Works for any public repo, registered or not. Unregistered repos are fetched live from GitHub.",
          parameters: [
            { name: "owner", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
            {
              name: "format",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["full", "compact"] },
            },
          ],
          responses: {
            "200": { description: "Repository snapshot" },
            "304": { description: "Not modified (ETag match)" },
            "400": { description: "Private repo" },
            "404": { description: "Repo does not exist on GitHub" },
            "502": { description: "GitHub fetch failed" },
          },
        },
      },
      "/v1/repo/{owner}/{name}/commits": {
        get: {
          summary: "Get stored commit history (requires registration)",
          parameters: [
            { name: "owner", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 200 } },
            { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          ],
          responses: { "200": { description: "Commit list" } },
        },
      },
      "/v1/repo/{owner}/{name}/stats": {
        get: {
          summary: "Get historical snapshot stats over time (requires registration)",
          parameters: [
            { name: "owner", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 200 } },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          ],
          responses: { "200": { description: "Stats history" } },
        },
      },
      "/v1/repo/{owner}/{name}/events": {
        get: {
          summary: "Get recent detected events (requires registration)",
          parameters: [
            { name: "owner", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 200 } },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
            {
              name: "type",
              in: "query",
              description: "Comma-separated event types to filter by",
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Event list" } },
        },
      },
      "/v1/repo/{owner}/{name}/languages": {
        get: { summary: "Get language breakdown", responses: { "200": { description: "Language breakdown" } } },
      },
      "/v1/repo/{owner}/{name}/contributors": {
        get: { summary: "Get top contributors", responses: { "200": { description: "Contributor list" } } },
      },
      "/v1/repo/{owner}/{name}/releases": {
        get: { summary: "Get the latest release", responses: { "200": { description: "Latest release" } } },
      },
      "/v1/repo/{owner}/{name}/branches": {
        get: { summary: "Get all branches", responses: { "200": { description: "Branch list" } } },
      },
      "/v1/repo/{owner}/{name}/tags": {
        get: { summary: "Get all tags", responses: { "200": { description: "Tag list" } } },
      },
      "/v1/repo/{owner}/{name}/issues": {
        get: {
          summary: "Get issues (pull requests excluded)",
          parameters: [
            {
              name: "state",
              in: "query",
              schema: { type: "string", enum: ["open", "closed", "all"] },
            },
          ],
          responses: { "200": { description: "Issue list" } },
        },
      },
      "/v1/repo/{owner}/{name}/pulls": {
        get: {
          summary: "Get pull requests",
          parameters: [
            {
              name: "state",
              in: "query",
              schema: { type: "string", enum: ["open", "closed", "all"] },
            },
          ],
          responses: { "200": { description: "Pull request list" } },
        },
      },
      "/v1/repo/{owner}/{name}/badge": {
        get: {
          summary: "Get an SVG badge",
          parameters: [
            { name: "label", in: "query", schema: { type: "string" } },
            { name: "color", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "SVG image", content: { "image/svg+xml": {} } } },
        },
      },
      "/v1/repo/{owner}/{name}/register": {
        post: {
          summary: "Register a public repo for tracking",
          responses: {
            "201": { description: "Registered (includes one-time webhook secret if newly created)" },
            "400": { description: "Private repo" },
            "404": { description: "Repo does not exist" },
          },
        },
      },
      "/v1/repo/{owner}/{name}/refresh": {
        post: {
          summary: "Force an immediate re-poll (rate-limited to once per 30s)",
          responses: { "200": { description: "Refreshed" }, "429": { description: "On cooldown" } },
        },
      },
      "/v1/repo/{owner}/{name}/webhook": {
        get: { summary: "Get webhook status (does not reveal the secret)", responses: { "200": { description: "Status" } } },
        post: {
          summary: "Generate a new webhook secret (shown once, invalidates any previous one)",
          responses: { "200": { description: "New secret" } },
        },
      },
      "/v1/repos": {
        get: {
          summary: "Batch fetch up to 20 repos in one call",
          parameters: [
            {
              name: "repos",
              in: "query",
              required: true,
              description: "Comma-separated owner/name pairs",
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Array of per-repo results" } },
        },
      },
      "/v1/keys": {
        post: {
          summary: "Create a new API key (self-serve, no gate)",
          responses: { "201": { description: "New key (shown once)" } },
        },
      },
      "/v1/keys/revoke": {
        post: {
          summary: "Revoke an API key",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "Revoked" }, "404": { description: "Key not found" } },
        },
      },
      "/v1/health": {
        get: { summary: "Service health check", responses: { "200": { description: "Healthy" }, "503": { description: "Degraded" } } },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Optional API key for a higher rate limit" },
      },
    },
  };

  return c.json(spec);
});
