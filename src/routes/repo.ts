import { Hono, type Context, type Next } from "hono";
import { fetchRepoSnapshot, fetchBranches, fetchTags, fetchIssues, fetchPullRequests, PrivateRepoError } from "../github/normalize.js";
import {
  getCachedSnapshot,
  setCachedSnapshot,
  incrementSubscriberCount,
  decrementSubscriberCount,
  getSnapshotVersion,
} from "../cache/kv.js";
import { findRepo, registerRepo, regenerateWebhookSecret } from "../db/repos.js";
import { getCommitHistory, countCommits } from "../db/commits.js";
import { getSnapshotHistory, countSnapshots } from "../db/snapshots.js";
import { getRecentEvents, getEventsSince, getLatestEventId, countEvents } from "../db/events.js";
import { getRepo, GitHubApiError } from "../github/client.js";
import { pollOneRepo } from "../jobs/poll-stats.js";
import { AROVE_EVENT_TYPES } from "../types/arove.js";
import type {
  ApiError,
  AroveEventType,
  Env,
  RepoSnapshot,
  RepoSnapshotCompact,
} from "../types/arove.js";

export const repoRoutes = new Hono<{ Bindings: Env }>();
export const batchRoutes = new Hono<{ Bindings: Env }>();

const MAX_LIMIT = 200;
const DEFAULT_COMMITS_LIMIT = 50;
const DEFAULT_STATS_LIMIT = 100;
const REFRESH_COOLDOWN_SECONDS = 30;

function toCompact(snapshot: RepoSnapshot): RepoSnapshotCompact {
  const lastCommit = snapshot.latestCommits[0] ?? null;
  return {
    repo: snapshot.repo.fullName,
    stars: snapshot.stats.stars,
    forks: snapshot.stats.forks,
    openIssues: snapshot.stats.openIssues,
    lastCommitSha: lastCommit?.sha ?? null,
    lastCommitAt: lastCommit?.committedAt ?? null,
    fetchedAt: snapshot.fetchedAt,
  };
}

function errorResponse(status: number, error: string, message: string): ApiError {
  return { error, message, status };
}

function parseBoundedLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function parsePage(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
}

function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
  };
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function etagFor(payload: unknown): string {
  const json = JSON.stringify(payload);
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    hash = (hash * 31 + json.charCodeAt(i)) | 0;
  }
  return `"${Math.abs(hash).toString(36)}-${json.length}"`;
}

async function getSnapshotOrFetch(
  env: Env,
  owner: string,
  name: string
): Promise<RepoSnapshot> {
  const fullName = `${owner}/${name}`;
  const cached = await getCachedSnapshot<RepoSnapshot>(env.CACHE, fullName);
  if (cached) return cached;

  const fresh = await fetchRepoSnapshot(env, owner, name);
  await setCachedSnapshot(env.CACHE, fullName, fresh);
  return fresh;
}

const GITHUB_OWNER_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const GITHUB_REPO_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,100}$/;

function isValidOwner(owner: string): boolean {
  return GITHUB_OWNER_PATTERN.test(owner);
}

function isValidRepoName(name: string): boolean {
  return GITHUB_REPO_NAME_PATTERN.test(name) && name !== "." && name !== "..";
}

function validateRepoParams() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const { owner, name } = c.req.param();
    if (!isValidOwner(owner) || !isValidRepoName(name)) {
      return c.json(
        errorResponse(400, "invalid_repo_identifier", "Owner or repo name is not a valid GitHub identifier."),
        400
      );
    }
    await next();
  };
}

repoRoutes.use("/:owner/:name", validateRepoParams());
repoRoutes.use("/:owner/:name/*", validateRepoParams());

async function verifyPublicRepoExists(
  env: Env,
  owner: string,
  name: string
): Promise<
  | { ok: true }
  | { ok: false; status: 400 | 404 | 502; error: string; message: string }
> {
  try {
    const ghRepo = await getRepo(env, owner, name);
    if (ghRepo.private) {
      return {
        ok: false,
        status: 400,
        error: "private_repo",
        message: "Arove only supports public repositories.",
      };
    }
    return { ok: true };
  } catch (err: unknown) {
    if (err instanceof GitHubApiError && err.status === 404) {
      return {
        ok: false,
        status: 404,
        error: "repo_not_found",
        message: `${owner}/${name} does not exist on GitHub.`,
      };
    }
    console.error(`[repo] GitHub existence check failed for ${owner}/${name}:`, err);
    return {
      ok: false,
      status: 502,
      error: "upstream_fetch_failed",
      message: "Could not verify repo with GitHub.",
    };
  }
}

repoRoutes.get("/:owner/:name", async (c) => {
  const { owner, name } = c.req.param();
  const upgradeHeader = c.req.header("upgrade");

  const registered = await findRepo(c.env.DB, owner, name);

  if (upgradeHeader?.toLowerCase() === "websocket") {
    if (!registered) {
      const check = await verifyPublicRepoExists(c.env, owner, name);
      if (!check.ok) {
        return c.json(errorResponse(check.status, check.error, check.message), check.status);
      }
    }
    return handleWebSocketUpgrade(c.env, owner, name, registered?.id ?? null, c.req.raw);
  }

  try {
    const format = c.req.query("format");
    const snapshot = await getSnapshotOrFetch(c.env, owner, name);
    const body = format === "compact" ? toCompact(snapshot) : snapshot;

    const tag = etagFor(body);
    if (c.req.header("if-none-match") === tag) {
      return c.body(null, 304);
    }

    c.header("ETag", tag);
    c.header("Cache-Control", "public, max-age=30");
    c.header("X-Arove-Registered", registered ? "true" : "false");
    return c.json(body);
  } catch (err) {
    return handleSnapshotFetchError(c, owner, name, err);
  }
});

repoRoutes.get("/:owner/:name/commits", async (c) => {
  const { owner, name } = c.req.param();
  const repo = await findRepo(c.env.DB, owner, name);
  if (!repo) {
    return c.json(
      errorResponse(
        404,
        "history_unavailable",
        `${owner}/${name} isn't registered, so Arove has no stored commit history for it yet. ` +
          `POST /v1/repo/${owner}/${name}/register to start tracking history, or use the live ` +
          "GitHub API directly for a one-off commit list."
      ),
      404
    );
  }

  const limit = parseBoundedLimit(c.req.query("limit"), DEFAULT_COMMITS_LIMIT);
  const page = parsePage(c.req.query("page"));
  const since = c.req.query("since");
  const offset = (page - 1) * limit;

  const [commits, total] = await Promise.all([
    getCommitHistory(c.env.DB, repo.id, limit, since, offset),
    countCommits(c.env.DB, repo.id),
  ]);

  return c.json({
    repo: `${owner}/${name}`,
    commits,
    pagination: buildPaginationMeta(page, limit, total),
  });
});

repoRoutes.get("/:owner/:name/stats", async (c) => {
  const { owner, name } = c.req.param();
  const repo = await findRepo(c.env.DB, owner, name);
  if (!repo) {
    return c.json(
      errorResponse(
        404,
        "history_unavailable",
        `${owner}/${name} isn't registered, so Arove has no stored stats history for it yet. ` +
          `POST /v1/repo/${owner}/${name}/register to start tracking history over time.`
      ),
      404
    );
  }

  const limit = parseBoundedLimit(c.req.query("limit"), DEFAULT_STATS_LIMIT);
  const page = parsePage(c.req.query("page"));
  const offset = (page - 1) * limit;

  const [history, total] = await Promise.all([
    getSnapshotHistory(c.env.DB, repo.id, limit, offset),
    countSnapshots(c.env.DB, repo.id),
  ]);

  return c.json({
    repo: `${owner}/${name}`,
    history,
    pagination: buildPaginationMeta(page, limit, total),
  });
});

repoRoutes.get("/:owner/:name/events", async (c) => {
  const { owner, name } = c.req.param();
  const repo = await findRepo(c.env.DB, owner, name);
  if (!repo) {
    return c.json(
      errorResponse(
        404,
        "history_unavailable",
        `${owner}/${name} isn't registered, so Arove has no event history for it yet. ` +
          `POST /v1/repo/${owner}/${name}/register to start tracking events.`
      ),
      404
    );
  }

  const limit = parseBoundedLimit(c.req.query("limit"), DEFAULT_STATS_LIMIT);
  const page = parsePage(c.req.query("page"));
  const offset = (page - 1) * limit;
  const typeParam = c.req.query("type");
  const eventTypes = typeParam
    ? (typeParam.split(",").filter((t) => (AROVE_EVENT_TYPES as readonly string[]).includes(t)) as AroveEventType[])
    : undefined;

  const [events, total] = await Promise.all([
    getRecentEvents(c.env.DB, repo.id, limit, offset, eventTypes),
    countEvents(c.env.DB, repo.id, eventTypes),
  ]);

  return c.json({
    repo: `${owner}/${name}`,
    events,
    pagination: buildPaginationMeta(page, limit, total),
  });
});

function handleSnapshotFetchError(
  c: Context<{ Bindings: Env }>,
  owner: string,
  name: string,
  err: unknown
): Response {
  if (err instanceof PrivateRepoError) {
    return c.json(
      errorResponse(400, "private_repo", "Arove only supports public repositories."),
      400
    );
  }
  if (err instanceof GitHubApiError && err.status === 404) {
    return c.json(
      errorResponse(404, "repo_not_found", `${owner}/${name} does not exist on GitHub.`),
      404
    );
  }
  console.error(`[repo] snapshot fetch failed for ${owner}/${name}:`, err);
  return c.json(
    errorResponse(502, "upstream_fetch_failed", "Could not fetch repo data from GitHub."),
    502
  );
}

async function getCachedListOrFetch<T>(
  env: Env,
  cacheKey: string,
  fetcher: () => Promise<T>,
  ttlSeconds = 45
): Promise<T> {
  const cached = await getCachedSnapshot<T>(env.CACHE, cacheKey);
  if (cached) return cached;
  const fresh = await fetcher();
  await setCachedSnapshot(env.CACHE, cacheKey, fresh, ttlSeconds);
  return fresh;
}

repoRoutes.get("/:owner/:name/branches", async (c) => {
  const { owner, name } = c.req.param();
  try {
    const branches = await getCachedListOrFetch(
      c.env,
      `branches:${owner}/${name}`,
      () => fetchBranches(c.env, owner, name)
    );
    return c.json({ repo: `${owner}/${name}`, branches });
  } catch (err) {
    return handleSnapshotFetchError(c, owner, name, err);
  }
});

repoRoutes.get("/:owner/:name/tags", async (c) => {
  const { owner, name } = c.req.param();
  try {
    const tags = await getCachedListOrFetch(
      c.env,
      `tags:${owner}/${name}`,
      () => fetchTags(c.env, owner, name)
    );
    return c.json({ repo: `${owner}/${name}`, tags });
  } catch (err) {
    return handleSnapshotFetchError(c, owner, name, err);
  }
});

repoRoutes.get("/:owner/:name/issues", async (c) => {
  const { owner, name } = c.req.param();
  const state = c.req.query("state");
  const validState = state === "open" || state === "closed" || state === "all" ? state : "open";
  try {
    const issues = await getCachedListOrFetch(
      c.env,
      `issues:${validState}:${owner}/${name}`,
      () => fetchIssues(c.env, owner, name, validState)
    );
    return c.json({ repo: `${owner}/${name}`, state: validState, issues });
  } catch (err) {
    return handleSnapshotFetchError(c, owner, name, err);
  }
});

repoRoutes.get("/:owner/:name/pulls", async (c) => {
  const { owner, name } = c.req.param();
  const state = c.req.query("state");
  const validState = state === "open" || state === "closed" || state === "all" ? state : "open";
  try {
    const pulls = await getCachedListOrFetch(
      c.env,
      `pulls:${validState}:${owner}/${name}`,
      () => fetchPullRequests(c.env, owner, name, validState)
    );
    return c.json({ repo: `${owner}/${name}`, state: validState, pulls });
  } catch (err) {
    return handleSnapshotFetchError(c, owner, name, err);
  }
});

repoRoutes.get("/:owner/:name/languages", async (c) => {
  const { owner, name } = c.req.param();
  try {
    const snapshot = await getSnapshotOrFetch(c.env, owner, name);
    return c.json({ repo: `${owner}/${name}`, languages: snapshot.languages });
  } catch (err) {
    return handleSnapshotFetchError(c, owner, name, err);
  }
});

repoRoutes.get("/:owner/:name/contributors", async (c) => {
  const { owner, name } = c.req.param();
  try {
    const snapshot = await getSnapshotOrFetch(c.env, owner, name);
    return c.json({ repo: `${owner}/${name}`, contributors: snapshot.topContributors });
  } catch (err) {
    return handleSnapshotFetchError(c, owner, name, err);
  }
});

repoRoutes.get("/:owner/:name/releases", async (c) => {
  const { owner, name } = c.req.param();
  try {
    const snapshot = await getSnapshotOrFetch(c.env, owner, name);
    return c.json({ repo: `${owner}/${name}`, latestRelease: snapshot.latestRelease });
  } catch (err) {
    return handleSnapshotFetchError(c, owner, name, err);
  }
});

repoRoutes.get("/:owner/:name/badge", async (c) => {
  const { owner, name } = c.req.param();
  const label = (c.req.query("label") ?? "stars").slice(0, 20);
  const color =
    (c.req.query("color") ?? "3fb950").replace(/[^0-9a-fA-F]/g, "").slice(0, 6) || "3fb950";

  let value: string;
  try {
    const snapshot = await getSnapshotOrFetch(c.env, owner, name);
    switch (label) {
      case "forks":
        value = String(snapshot.stats.forks);
        break;
      case "issues":
        value = String(snapshot.stats.openIssues);
        break;
      case "stars":
      default:
        value = String(snapshot.stats.stars);
        break;
    }
  } catch {
    value = "n/a";
  }

  const labelText = escapeXml(label.charAt(0).toUpperCase() + label.slice(1));
  const valueText = escapeXml(value);
  const labelWidth = 6.2 * labelText.length + 20;
  const valueWidth = 6.2 * valueText.length + 20;
  const totalWidth = labelWidth + valueWidth;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${labelText}: ${valueText}">
<linearGradient id="s" x2="0" y2="100%">
<stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
<stop offset="1" stop-opacity=".1"/>
</linearGradient>
<clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)">
<rect width="${labelWidth}" height="20" fill="#555"/>
<rect x="${labelWidth}" width="${valueWidth}" height="20" fill="#${color}"/>
<rect width="${totalWidth}" height="20" fill="url(#s)"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,sans-serif" font-size="11">
<text x="${labelWidth / 2}" y="14">${labelText}</text>
<text x="${labelWidth + valueWidth / 2}" y="14">${valueText}</text>
</g>
</svg>`;

  c.header("Content-Type", "image/svg+xml");
  c.header("Cache-Control", "public, max-age=300");
  return c.body(svg);
});

repoRoutes.post("/:owner/:name/register", async (c) => {
  const { owner, name } = c.req.param();

  const check = await verifyPublicRepoExists(c.env, owner, name);
  if (!check.ok) {
    return c.json(errorResponse(check.status, check.error, check.message), check.status);
  }

  const { repo, wasCreated } = await registerRepo(c.env.DB, owner, name);

  try {
    const snapshot = await fetchRepoSnapshot(c.env, owner, name);
    await setCachedSnapshot(c.env.CACHE, `${owner}/${name}`, snapshot);
  } catch (err) {
    console.error(`[register] initial fetch failed for ${owner}/${name}:`, err);
  }

  const webhookUrl = new URL("/v1/webhook/github", c.req.url).toString();

  return c.json(
    {
      registered: true,
      alreadyRegistered: !wasCreated,
      repo: `${owner}/${name}`,
      id: repo.id,
      webhook: wasCreated
        ? {
            url: webhookUrl,
            secret: repo.webhook_secret,
            note:
              "Save this secret now, it will not be shown again. Optional: add this " +
              "URL and secret as a webhook in your repo's settings (Settings > " +
              "Webhooks > Add webhook, content type application/json, events: " +
              "push/star/fork/release/issues/pull_request) for near-instant updates " +
              "instead of waiting for the next scheduled poll.",
          }
        : {
            url: webhookUrl,
            note:
              "This repo was already registered. Its webhook secret is not shown " +
              "again for security reasons. POST /v1/repo/:owner/:name/webhook to " +
              "generate a new one if needed.",
          },
    },
    201
  );
});

repoRoutes.get("/:owner/:name/webhook", async (c) => {
  const { owner, name } = c.req.param();
  const repo = await findRepo(c.env.DB, owner, name);
  if (!repo) {
    return c.json(errorResponse(404, "repo_not_registered", "Repo not registered."), 404);
  }

  const webhookUrl = new URL("/v1/webhook/github", c.req.url).toString();

  return c.json({
    repo: `${owner}/${name}`,
    webhook: {
      url: webhookUrl,
      configured: repo.last_webhook_at !== null,
      lastReceivedAt: repo.last_webhook_at,
      note: repo.webhook_secret
        ? "A secret already exists for this repo but is not retrievable for security reasons. POST to this same path to generate a new one (this invalidates the old one)."
        : "No secret has been generated yet. POST to this same path to create one.",
    },
  });
});

repoRoutes.post("/:owner/:name/webhook", async (c) => {
  const { owner, name } = c.req.param();
  const repo = await findRepo(c.env.DB, owner, name);
  if (!repo) {
    return c.json(errorResponse(404, "repo_not_registered", "Repo not registered."), 404);
  }

  const secret = await regenerateWebhookSecret(c.env.DB, repo.id);
  const webhookUrl = new URL("/v1/webhook/github", c.req.url).toString();

  return c.json({
    repo: `${owner}/${name}`,
    webhook: {
      url: webhookUrl,
      secret,
      note:
        "Save this secret now, it will not be shown again. Add it as a webhook in " +
        "your repo's settings (Settings > Webhooks > Add webhook, content type " +
        "application/json, events: push/star/fork/release/issues/pull_request) " +
        "for near-instant updates instead of waiting for the next scheduled poll. " +
        "Calling this again generates a new secret and invalidates this one.",
    },
  });
});

repoRoutes.post("/:owner/:name/refresh", async (c) => {
  const { owner, name } = c.req.param();
  const fullName = `${owner}/${name}`;

  const repo = await findRepo(c.env.DB, owner, name);
  if (!repo) {
    return c.json(errorResponse(404, "repo_not_registered", "Repo not registered."), 404);
  }

  const cooldownKey = `refresh-cooldown:${fullName}`;
  const onCooldown = await c.env.CACHE.get(cooldownKey);
  if (onCooldown) {
    return c.json(
      errorResponse(429, "refresh_rate_limited", "Refresh already happened recently."),
      429
    );
  }

  await c.env.CACHE.put(cooldownKey, "1", { expirationTtl: REFRESH_COOLDOWN_SECONDS });

  try {
    await pollOneRepo(c.env, owner, name, repo.id);
  } catch (err) {
    console.error(`[refresh] failed for ${fullName}:`, err);
    if (err instanceof PrivateRepoError) {
      return c.json(
        errorResponse(400, "private_repo", `${fullName} appears to have been made private on GitHub.`),
        400
      );
    }
    return c.json(
      errorResponse(502, "upstream_fetch_failed", "Could not refresh repo data from GitHub."),
      502
    );
  }

  const snapshot = await getSnapshotOrFetch(c.env, owner, name);
  return c.json({ refreshed: true, repo: fullName, snapshot });
});

batchRoutes.get("/", async (c) => {
  const reposParam = c.req.query("repos");
  if (!reposParam) {
    return c.json(
      errorResponse(400, "missing_repos", "Provide ?repos=owner/name,owner2/name2"),
      400
    );
  }

  const entries = reposParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);

  const results = await Promise.all(
    entries.map(async (entry) => {
      const [owner, name] = entry.split("/");
      if (!owner || !name || !isValidOwner(owner) || !isValidRepoName(name)) {
        return { repo: entry, error: "invalid_repo_format" };
      }
      try {
        const snapshot = await getSnapshotOrFetch(c.env, owner, name);
        return { repo: entry, snapshot };
      } catch (err) {
        if (err instanceof PrivateRepoError) {
          return { repo: entry, error: "private_repo" };
        }
        if (err instanceof GitHubApiError && err.status === 404) {
          return { repo: entry, error: "repo_not_found" };
        }
        return { repo: entry, error: "upstream_fetch_failed" };
      }
    })
  );

  return c.json({ results });
});

const VALID_EVENT_TYPES: ReadonlySet<string> = new Set(AROVE_EVENT_TYPES);

function parseEventFilter(request: Request): Set<string> | null {
  const url = new URL(request.url);
  const raw = url.searchParams.get("events");
  if (!raw) return null;

  const requested = raw
    .split(",")
    .map((s) => s.trim())
    .filter((e) => VALID_EVENT_TYPES.has(e));

  return requested.length > 0 ? new Set(requested) : null;
}

function handleWebSocketUpgrade(
  env: Env,
  owner: string,
  name: string,
  repoId: number | null,
  request: Request
): Response {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  const fullName = `${owner}/${name}`;
  const eventFilter = parseEventFilter(request);
  const isTracked = repoId !== null;

  server.accept();

  let closed = false;
  let lastSentSnapshotJson: string | null = null;
  let lastSeenVersion = 0;
  let lastSeenEventId = 0;
  let consecutiveFailures = 0;
  let interval: ReturnType<typeof setInterval>;
  const checkIntervalMs = Number(env.SOCKET_CHECK_INTERVAL_MS) || 25_000;
  const MAX_CONSECUTIVE_FAILURES = 5;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    void decrementSubscriberCount(env.CACHE, fullName);
  };

  const safeSend = (payload: unknown): boolean => {
    if (closed) return false;
    try {
      server.send(JSON.stringify(payload));
      return true;
    } catch (err) {
      console.error(`[ws] send failed for ${fullName}, treating as closed:`, err);
      cleanup();
      return false;
    }
  };

  const sendEvent = (eventRow: { event_type: AroveEventType; payload: string; detected_at: string }) => {
    if (eventFilter && !eventFilter.has(eventRow.event_type)) return;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(eventRow.payload);
    } catch {}
    safeSend({ type: "event", event: eventRow.event_type, data, ts: eventRow.detected_at });
  };

  let ready = false;

  const sendHello = async () => {
    try {
      const snapshot = await getSnapshotOrFetch(env, owner, name);
      lastSentSnapshotJson = JSON.stringify(snapshot);
      safeSend({ type: "hello", repo: fullName, tracked: isTracked, snapshot });

      if (isTracked && repoId !== null) {
        lastSeenVersion = await getSnapshotVersion(env.CACHE, fullName);
        lastSeenEventId = await getLatestEventId(env.DB, repoId);
      }
    } catch (err) {
      console.error(`[ws] initial snapshot fetch failed for ${fullName}:`, err);
      const message =
        err instanceof PrivateRepoError
          ? `${fullName} appears to be private and can't be tracked.`
          : "Could not fetch initial snapshot. Will keep retrying.";
      safeSend({ type: "error", message });
    } finally {
      ready = true;
    }
  };

  const checkTrackedRepo = async () => {
    if (repoId === null || !ready) return;
    try {
      const currentVersion = await getSnapshotVersion(env.CACHE, fullName);
      consecutiveFailures = 0;

      if (currentVersion !== lastSeenVersion) {
        const newEvents = await getEventsSince(env.DB, repoId, lastSeenEventId, 20);
        for (const row of newEvents) {
          sendEvent(row);
          lastSeenEventId = row.id;
        }
        lastSeenVersion = currentVersion;
      }
    } catch (err) {
      consecutiveFailures += 1;
      console.error(
        `[ws] version check failed for ${fullName} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
        err
      );
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        safeSend({
          type: "error",
          message: `Failed to check for updates ${consecutiveFailures} times in a row.`,
        });
      }
    }
  };

  const checkUntrackedRepo = async () => {
    try {
      const snapshot = await getSnapshotOrFetch(env, owner, name);
      consecutiveFailures = 0;
      const currentJson = JSON.stringify(snapshot);

      if (lastSentSnapshotJson && currentJson !== lastSentSnapshotJson) {
        const prev = JSON.parse(lastSentSnapshotJson) as RepoSnapshot;
        const ts = new Date().toISOString();

        if (snapshot.stats.stars !== prev.stats.stars) {
          sendEvent({ event_type: "star", payload: JSON.stringify({ from: prev.stats.stars, to: snapshot.stats.stars }), detected_at: ts });
        }
        if (snapshot.stats.forks !== prev.stats.forks) {
          sendEvent({ event_type: "fork", payload: JSON.stringify({ from: prev.stats.forks, to: snapshot.stats.forks }), detected_at: ts });
        }
        if (snapshot.stats.openIssues !== prev.stats.openIssues) {
          sendEvent({ event_type: "issue", payload: JSON.stringify({ from: prev.stats.openIssues, to: snapshot.stats.openIssues }), detected_at: ts });
        }

        const prevReleaseTag = prev.latestRelease?.tagName;
        const currentReleaseTag = snapshot.latestRelease?.tagName;
        if (currentReleaseTag && currentReleaseTag !== prevReleaseTag) {
          sendEvent({
            event_type: "release",
            payload: JSON.stringify({
              tag: currentReleaseTag,
              name: snapshot.latestRelease?.name,
              url: snapshot.latestRelease?.url,
            }),
            detected_at: ts,
          });
        }

        const prevSha = prev.latestCommits[0]?.sha;
        const currentSha = snapshot.latestCommits[0]?.sha;
        if (currentSha && currentSha !== prevSha) {
          sendEvent({
            event_type: "push",
            payload: JSON.stringify({
              sha: currentSha,
              message: snapshot.latestCommits[0]?.message,
              author: snapshot.latestCommits[0]?.authorLogin ?? snapshot.latestCommits[0]?.authorName,
            }),
            detected_at: ts,
          });
        }
      }

      lastSentSnapshotJson = currentJson;
    } catch (err) {
      consecutiveFailures += 1;
      console.error(
        `[ws] update check failed for ${fullName} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
        err
      );
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        safeSend({
          type: "error",
          message: `Failed to fetch repo data ${consecutiveFailures} times in a row. The repo may be unavailable.`,
        });
      }
    }
  };

  const checkForUpdates = () => (isTracked ? checkTrackedRepo() : checkUntrackedRepo());

  const KEEPALIVE_TICKS = 4;
  let ticksSinceKeepalive = 0;

  const tick = async () => {
    if (closed) return;
    await checkForUpdates();
    ticksSinceKeepalive += 1;
    if (ticksSinceKeepalive >= KEEPALIVE_TICKS) {
      ticksSinceKeepalive = 0;
      safeSend({ type: "ping", ts: new Date().toISOString() });
    }
  };

  server.addEventListener("message", (event: MessageEvent) => {
    if (closed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof event.data === "string" ? event.data : "");
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return;
    const messageType = (parsed as { type: unknown }).type;

    if (messageType === "refresh") {
      void checkForUpdates();
    }
  });

  void incrementSubscriberCount(env.CACHE, fullName);
  void sendHello();

  interval = setInterval(() => void tick(), checkIntervalMs);

  server.addEventListener("close", cleanup);
  server.addEventListener("error", cleanup);

  return new Response(null, { status: 101, webSocket: client });
}
