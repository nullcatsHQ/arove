import { Hono } from "hono";
import { verifyGitHubSignature } from "../github/webhook.js";
import { findRepo, markWebhookReceived } from "../db/repos.js";
import { insertEvent } from "../db/events.js";
import { insertSnapshot } from "../db/snapshots.js";
import { upsertCommits } from "../db/commits.js";
import { setCachedSnapshot } from "../cache/kv.js";
import { fetchRepoSnapshot } from "../github/normalize.js";
import type { ApiError, Env, AroveEventType } from "../types/arove.js";

export const webhookRoutes = new Hono<{ Bindings: Env }>();

function errorResponse(status: number, error: string, message: string): ApiError {
  return { error, message, status };
}

const GITHUB_EVENT_TO_AROVE: Record<string, AroveEventType | undefined> = {
  push: "push",
  star: "star",
  fork: "fork",
  release: "release",
  issues: "issue",
  pull_request: "pull_request",
};

webhookRoutes.post("/github", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256");
  const githubEvent = c.req.header("x-github-event");
  const deliveryId = c.req.header("x-github-delivery");

  let payload: {
    repository?: { owner?: { login?: string }; name?: string };
    action?: string;
  };

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json(errorResponse(400, "invalid_payload", "Could not parse webhook payload."), 400);
  }

  const owner = payload.repository?.owner?.login;
  const name = payload.repository?.name;

  if (!owner || !name) {
    return c.json(
      errorResponse(400, "missing_repo_info", "Payload did not include repository owner/name."),
      400
    );
  }

  const repo = await findRepo(c.env.DB, owner, name);
  if (!repo) {
    return c.json(errorResponse(404, "repo_not_registered", "Repo not registered with Arove."), 404);
  }

  if (!repo.webhook_secret) {
    return c.json(
      errorResponse(409, "webhook_not_configured", "This repo has no webhook secret on file."),
      409
    );
  }

  const isValid = await verifyGitHubSignature(repo.webhook_secret, rawBody, signature);
  if (!isValid) {
    return c.json(errorResponse(401, "invalid_signature", "Webhook signature verification failed."), 401);
  }

  if (deliveryId) {
    const dedupeKey = `webhook-delivery:${deliveryId}`;
    const alreadySeen = await c.env.CACHE.get(dedupeKey);
    if (alreadySeen) {
      return c.json({ received: true, duplicate: true, event: githubEvent ?? "unknown" });
    }
    await c.env.CACHE.put(dedupeKey, "1", { expirationTtl: 600 });
  }

  await markWebhookReceived(c.env.DB, repo.id);

  const aroveEventType = githubEvent ? GITHUB_EVENT_TO_AROVE[githubEvent] : undefined;

  try {
    const snapshot = await fetchRepoSnapshot(c.env, owner, name);
    const fullName = `${owner}/${name}`;

    if (aroveEventType) {
      const eventPayload: Record<string, unknown> =
        aroveEventType === "release" && snapshot.latestRelease
          ? {
              tag: snapshot.latestRelease.tagName,
              name: snapshot.latestRelease.name,
              url: snapshot.latestRelease.url,
              source: "webhook",
            }
          : { action: payload.action ?? null, source: "webhook" };

      await insertEvent(c.env.DB, repo.id, aroveEventType, eventPayload);
    }

    await Promise.all([
      setCachedSnapshot(c.env.CACHE, fullName, snapshot),
      insertSnapshot(c.env.DB, {
        repoId: repo.id,
        stars: snapshot.stats.stars,
        forks: snapshot.stats.forks,
        watchers: snapshot.stats.watchers,
        openIssues: snapshot.stats.openIssues,
        openPullRequests: snapshot.stats.openPullRequests,
        languageBreakdown: snapshot.languages,
        sizeKb: snapshot.stats.sizeKb,
        defaultBranch: snapshot.stats.defaultBranch,
      }),
      upsertCommits(c.env.DB, repo.id, snapshot.latestCommits),
    ]);
  } catch (err) {
    console.error(`[webhook] refresh fetch failed for ${owner}/${name}:`, err);
  }

  return c.json({ received: true, event: githubEvent ?? "unknown" });
});
