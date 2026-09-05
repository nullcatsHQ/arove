<p align="center">
  <img src="https://i.postimg.cc/ZqhnDjPW/file-00000000f30c820b85c1a8d9a51fff23.png" alt="Arove" width="360">
</p>

<h3 align="center">Turn any public GitHub repo into a live, queryable snapshot</h3>

<p align="center">
  Stars, forks, commits, languages, contributors, releases, branches, tags, issues and pull requests, all as plain JSON. There's a WebSocket on the same address too, in case you'd rather have updates pushed to you instead of asking for them.
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square">
  <img alt="typescript" src="https://img.shields.io/badge/made%20with-TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="hono" src="https://img.shields.io/badge/runtime-Hono-e36002?style=flat-square&logo=hono&logoColor=white">
  <img alt="cost" src="https://img.shields.io/badge/cost-%240-success?style=flat-square">
  <img alt="stars" src="https://img.shields.io/github/stars/nullcatsHQ/arove?style=flat-square">
  <img alt="issues" src="https://img.shields.io/github/issues/nullcatsHQ/arove?style=flat-square">
  <img alt="last commit" src="https://img.shields.io/github/last-commit/nullcatsHQ/arove?style=flat-square">
  <img alt="prs" src="https://img.shields.io/badge/PRs-welcome-orange?style=flat-square">
</p>

<p align="center">
  <a href="#try-it-right-now">Try it</a> •
  <a href="#what-you-get">Endpoints</a> •
  <a href="#want-to-self-host-it-instead">Self host</a> •
  <a href="#a-word-on-rate-limits">Rate limits</a> •
  <a href="#contributing">Contributing</a>
</p>

<br>
For whatever you build 
– nullCats™
<br>

## The API is already running

You can start using Arove right now, this second, without installing anything.

```
https://api.arove.workers.dev
```

That's really the whole setup for most people. Drop in any public GitHub owner and repo name and you get data back. Keep reading to see it in action, or jump straight to [self hosting](#want-to-self-host-it-instead) if you'd rather run your own copy with your own rate limits.

<br>

## Try it right now

```bash
curl https://api.arove.workers.dev/v1/repo/vercel/next.js
```

```json
{
  "repo": {
    "owner": "vercel",
    "name": "next.js",
    "fullName": "vercel/next.js",
    "ownerAvatarUrl": "https://avatars.githubusercontent.com/u/14985020?v=4",
    "ownerType": "Organization"
  },
  "stats": {
    "stars": 132000,
    "forks": 27200,
    "openIssues": 2481,
    "defaultBranch": "canary",
    "license": "MIT",
    "description": "The React Framework"
  },
  "languages": {
    "TypeScript": { "bytes": 9431201, "percentage": 91.2 },
    "JavaScript": { "bytes": 612044, "percentage": 5.9 }
  },
  "latestCommits": [
    {
      "shortSha": "c3bdfff",
      "message": "fix: patch update for edge runtime",
      "authorLogin": "someone",
      "committedAt": "2026-09-04T09:52:24Z"
    }
  ],
  "health": {
    "hasReadme": true,
    "hasLicense": true,
    "daysSinceLastCommit": 0
  }
}
```

That's trimmed down for readability, and the numbers are just illustrative rather than something pulled live for this page. The actual response includes full contributor lists, release info, and everything else described below. You don't need to register a repo before asking about it either, an unregistered one just gets fetched fresh on the spot instead of pulled from stored history.

Want updates pushed to you instead of asking again and again? Open that same address as a WebSocket instead of a plain request and you'll get events as they happen.

> [!NOTE]
> `api.arove.workers.dev` is the real, live, public instance. Not a demo, not a placeholder domain, it's the actual thing running right now and you're welcome to build against it directly.

<br>

## What you get

| Endpoint | What it does |
|---|---|
| `GET /v1/repo/:owner/:name` | Full snapshot, works whether or not the repo is registered |
| `WS /v1/repo/:owner/:name` | Live updates on that exact same address |
| `GET /v1/repo/:owner/:name/commits` | Commit history |
| `GET /v1/repo/:owner/:name/branches` | Branch list |
| `GET /v1/repo/:owner/:name/tags` | Tag list |
| `GET /v1/repo/:owner/:name/issues` | Issue list |
| `GET /v1/repo/:owner/:name/pulls` | Pull request list |
| `GET /v1/repo/:owner/:name/languages` | Language breakdown |
| `GET /v1/repo/:owner/:name/contributors` | Top contributors |
| `GET /v1/repo/:owner/:name/releases` | Release history |
| `GET /v1/repo/:owner/:name/badge` | An embeddable stat badge for your own README |
| `POST /v1/repo/:owner/:name/register` | Start tracking history and enable webhooks |
| `GET /v1/repos?repos=a/b,c/d` | Batch lookup, up to 20 repos in one call |
| `POST /v1/keys` | Free, self serve API key for a higher rate limit |
| `GET /v1/openapi.json` | Full OpenAPI spec |

Every one of these already works against `api.arove.workers.dev`, no setup needed on your end.

### Drop a badge in your own README

Since Arove exposes a badge endpoint, you can embed a live stat straight into your own project's README without touching an image editor.

```markdown
![stars](https://api.arove.workers.dev/v1/repo/vercel/next.js/badge?label=stars&color=3fb950)
```

Swap the owner and repo, pick a label of stars, forks, or issues, and pick whatever color fits your README. It updates on its own every time someone loads the page.

<br>

## Why it exists

Most GitHub stat widgets lock you into one look and one host. Arove hands you raw data instead of a rendered widget, so your portfolio, dashboard, or README badge can end up looking like whatever you actually want it to look like. It borrows the "one URL, no config" feel of **Lanyard**, the Discord presence API, and points that same idea at GitHub instead.

<br>

## Want to self host it instead?

You genuinely don't have to. The public instance is free, it isn't going anywhere, and most people building a dashboard or a portfolio widget can just point at `api.arove.workers.dev` and never think about this section again.

But maybe you want your own rate limits, your own registered repos, or you just like owning the whole stack. Fair enough, here's how.

```bash
git clone https://github.com/nullcatsHQ/arove.git
cd arove
npm install
```

Then, in order:

**1. Database.** Create a SQL database through your platform's dashboard, then run `src/db/schema.sql` against it through the query console. If you're upgrading an existing deployment, also run whatever's inside `src/db/migrations` that you haven't applied yet, they're additive and safe to run against real data.

**2. Cache.** Create a key value store alongside it. Arove uses this for short lived caching, rate limit counters, and a few coordination flags. It starts empty and fills in on its own.

**3. Config.** Open `wrangler.toml` and drop your database ID and cache ID into the two binding blocks near the top.

**4. GitHub token.** Generate a personal access token, no scopes needed for public repo data, and add it as a secret named `GITHUB_TOKEN`. Want a higher rate limit? Add more as `GITHUB_TOKEN_2`, `GITHUB_TOKEN_3`, and so on, then set `TOKEN_COUNT` in `wrangler.toml` to match. One token is fine too, this is optional.

**5. Scheduled job.** A polling schedule is already defined in `wrangler.toml` under triggers, running once a minute. Confirm it shows up in your dashboard after deploying.

**6. Deploy.** Use your platform's CLI, or connect the repository for continuous deployment through its dashboard.

Once it's live, confirm everything's working:

```bash
curl https://your-deployment.example/v1/health
curl https://your-deployment.example/v1/repo/vercel/next.js
curl -X POST https://your-deployment.example/v1/repo/vercel/next.js/register
```

The health check should report everything healthy, the snapshot should come back immediately, and registering should hand you back a webhook URL and secret.

> [!CAUTION]
> Whatever webhook secret or API key you get back from any endpoint is shown exactly once and cannot be retrieved again. Save it the moment you see it. If you lose one, the fix is regenerating a new one, not recovering the old one.

<br>

## Instant updates through a webhook

Registering a repo gets you scheduled polling by default, so updates land within a minute or two. If you'd rather a specific repo update the moment something actually happens, grab the webhook URL and secret from the register response, or from `POST /v1/repo/:owner/:name/webhook` if you registered earlier and lost it, then add it under that repo's webhook settings on GitHub. Works the same whether you're on the public instance or your own.

## Using more than one GitHub token

If you're self hosting, Arove can round robin across several GitHub tokens so your effective rate limit budget multiplies with however many you're running. Set a token count in your config, add that many tokens as secrets, and Arove handles the rest, including skipping any token that's currently rate limited until it resets on its own.

> [!TIP]
> One token is enough for casual use. This only really matters if you're registering a lot of repos or expecting heavy traffic.

## Bring your own database

Every database call and every cache call in this entire project goes through exactly two folders, `src/db` and `src/cache`. Nothing else touches storage directly. Want Postgres, Redis, or something else entirely? See [`STORAGE.md`](./STORAGE.md) for the full function list to reimplement, plus a couple of worked examples showing the actual shape of the swap.

<br>

## A word on rate limits

Anonymous requests get a modest rate limit per address. If you're building something that calls Arove a lot, get a free key instead.

```bash
curl -X POST https://api.arove.workers.dev/v1/keys
```

That hands you back a key on the spot, no email, no waiting. Use it as a bearer token and your limit goes up substantially. The exact numbers aren't published here on purpose, check the `X-RateLimit-Remaining` header on any response if you want to know exactly where you stand.

<br>

## Project layout

```
src/
  index.ts        entry point
  routes/          HTTP and WebSocket handlers
  jobs/             scheduled polling logic
  github/            GitHub API client, token pool, data normalization
  db/                 database queries, swappable
  cache/               cache operations, swappable
  middleware/           rate limiting and optional API key auth
  types/                 shared types
```

## Fun fact

We lethally use $0 building this project, runs on nothing but free tiers, and that includes the public instance you can already query above.
This is a lesson to people who thinks that they can't build anything good if they don't invest any money. Just remember everything is possible if you have the potential.
At last this is a fun & wonderful experience for me (trmin) building this awesome project. 

<br>

## Contributing

Pull requests are genuinely welcome. Open an issue first if you're planning something bigger than a small fix, just so nobody's work crosses paths with anyone else's.

## License

MIT, see [`LICENSE`](./LICENSE) for the full text.

<br>

---

<p align="center">
  Made with 🖤 by the ItzTrmin <3
</p>

<p align="center">
  <sub>Copyright, all rights reserved, nullCats™&trade;</sub>
</p>

