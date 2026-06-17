# Hermes Security Dashboard

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Dashboard for **Hermes**, an agent that periodically runs security reviews on
Oasis Protocol GitHub repositories. It shows an overview of all repos and their
findings by severity, a live "active run" indicator, and per-repo review history
with full agent-generated review reports — including a run-over-run **diff**
(new / still-open / resolved findings).

The Hermes agent feeds the dashboard over a small HTTP API: it registers repos,
streams active-scan progress, and submits finished reports.

Built from a Claude Design prototype (Oasis-inspired: deep dark theme + teal
accent, Space Grotesk / IBM Plex Sans / IBM Plex Mono). Dark and light themes.

## Stack

- **SvelteKit 2 + Svelte 5** (runes), TypeScript, Vite — `adapter-node` standalone server
- **`node:sqlite`** — built-in synchronous SQLite, no native build step
- **`sanitize-html`** — sanitizes optional agent-submitted HTML report bodies
- CSS custom properties for the dark/light token system

## Run

```sh
bun install
bun run dev            # http://localhost:5173

bun run build          # production build (adapter-node)
node build             # serve build/ (PORT, default 3000)
```

On first boot the database is seeded with demo data (10 Oasis repos, realistic
findings, review history, a live scan). It's a no-op once real data exists.

Config via env (see `.env.example`): `HERMES_DB` (db path), `PORT`,
`HERMES_API_TOKEN` (optional write auth). For production — Docker, sub-path
hosting, and durable storage — see [Deploy](#deploy).

Drive the live UI like the real agent would:

```sh
HERMES_URL=http://localhost:5173 node scripts/simulate-scan.mjs sapphire-paratime
```

## Deploy

### Docker

Multi-stage build → a non-root Node 26 image (`node:sqlite` is built in) serving
the `adapter-node` server. Only production dependencies are installed; the rest
of the build output is self-contained.

```sh
# root-path deploy (default)
docker build -t hermes-dashboard .

# served under a sub-path behind a path-routing reverse proxy
docker build --build-arg BASE_PATH=/security -t hermes-dashboard .

# /data is the database volume; runs as UID:GID 10000:10000
docker run -p 3000:3000 -v hermes-data:/data hermes-dashboard
```

### Compose

`compose.yaml` is a ready-to-use reference (service, `/data` volume, env). Build
from source — the base path is set at build time:

```sh
docker compose up --build -d                 # root
BASE_PATH=/security docker compose up --build -d   # under /security
```

Or pull a published image instead by editing the `dashboard` service (comment
out `build:`, point `image:` at a tag below). The file also includes a
commented rclone sidecar sketch for the snapshot sync.

### Published images

CI publishes two variants to GHCR (the base path is baked, so each is a separate
tag). Make the package public in the repo's Packages settings for anonymous pulls.

```sh
# root-path
docker pull ghcr.io/rube-de/hermes-security-dashboard:latest
# served under /security
docker pull ghcr.io/rube-de/hermes-security-dashboard:latest-security
```

Also tagged per branch, short SHA, and semver (`vX.Y.Z` releases also produce the
`-security` variant). A published image's base path **cannot** be changed at
runtime — pick the matching tag, or build from source with your own `BASE_PATH`.

### Base path

`BASE_PATH` is baked at **build time** (SvelteKit `paths.base`); it must start
with `/` and not end with `/`. With it set, the **entire app — UI *and*
`/api/*` — responds only under that prefix, and the root 404s.** Every caller
must include the prefix, including the Hermes agent's push API:

```sh
# built with BASE_PATH=/security → push to the prefixed URL
curl -X POST localhost:3000/security/api/repos/sapphire-paratime/reviews ...
# or with the simulator:
HERMES_URL=http://localhost:3000/security node scripts/simulate-scan.mjs
```

Left unset, the app serves at the root exactly as before — `bun run dev` and
root-path deploys are unchanged.

### Durability (externally file-synced volume)

In production `HERMES_DB` lives on a volume that a separate sidecar periodically
file-copies to object storage and restores on redeploy. Copying a live SQLite
file with an external tool is unsafe, so the live DB (WAL mode) is **never**
copied directly. Instead the server:

- emits a consistent snapshot (`VACUUM INTO` a temp file + atomic rename) on an
  interval (`HERMES_SNAPSHOT_INTERVAL` seconds, default 300) **and** on graceful
  shutdown (SIGTERM/SIGINT → final snapshot → exit 0);
- checkpoints the WAL (`TRUNCATE`) each cycle so `-wal` stays bounded;
- on startup, if the live DB is missing/empty but the snapshot exists, restores
  it into place **before** seeding — so real synced data suppresses demo data.

Point the sync sidecar at the snapshot file (default `${HERMES_DB}.snapshot`),
**never** the live `.db` / `-wal` / `-shm`.

### Environment

| Var | Default | Purpose |
| --- | --- | --- |
| `HERMES_DB` | `hermes.db` (`/data/hermes.db` in Docker) | Live SQLite path |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | adapter-node bind |
| `HERMES_API_TOKEN` | _unset_ | Bearer auth for writes; unset = open (loud startup warning in production) |
| `HERMES_SEED_DEMO` | `true` | Seed demo data on an empty DB; set `false` in production to start empty |
| `HERMES_DB_SNAPSHOT` | `${HERMES_DB}.snapshot` | Snapshot file the sync layer copies |
| `HERMES_SNAPSHOT_INTERVAL` | `300` | Seconds between snapshot/checkpoint cycles |
| `BASE_PATH` | `''` | Sub-path prefix — **build arg**, baked at build time |

## Pages

| Route                          | What                                                        |
| ------------------------------ | ---------------------------------------------------------- |
| `/`                            | Overview — totals by severity, run strip, trend, repo list with search + status/severity filters |
| `/repo/[id]`                   | Repo detail — metric summary, live scan banner, review history |
| `/repo/[id]/review/[reviewId]` | Review report — severity band, summary, diff vs previous run, findings with code + remediation, resolved section |

UI pages read directly from the database via server `load`. The active-run
banner additionally polls `GET /api/scan` so the agent's progress shows live.

## Agent API

A machine-readable **OpenAPI 3.1** spec lives at
[`src/lib/server/openapi.yaml`](src/lib/server/openapi.yaml). The app serves it
and renders browsable docs:

- **`/docs`** — rendered API reference ([Scalar](https://github.com/scalar/scalar)).
- **`/openapi.yaml`** — the raw spec.
- **`/api/openapi.json`** — the spec as JSON, for codegen/tooling.

(Under a sub-path deploy each sits beneath the base path, e.g. `/security/docs`.)
The tables below mirror the spec; the route handlers remain the source of truth.

Base path `/api`. Reads are open; **writes** honour `HERMES_API_TOKEN` if set
(`Authorization: Bearer <token>`), otherwise are unauthenticated.

The producer is the Hermes agent itself: it runs the security review on a
schedule (a cron-style task configured agent-side) and POSTs each result to the
write endpoints below with `HERMES_API_TOKEN`. Nothing here schedules anything —
the dashboard only stores and renders what the agent pushes. When the dashboard
sits behind a reverse proxy that gates the UI (e.g. a SIWE wallet gateway), the
scheduled job can't authenticate through that gate; it should reach the dashboard
**directly on the internal network**, including the base-path prefix if one is
baked in:

```sh
# push directly to the internal host, with the /security prefix and the token;
# body is the same shape as "Submit a review report" below
curl -X POST http://hermes-security-dashboard:3000/security/api/repos/:id/reviews \
  -H "Authorization: Bearer $HERMES_API_TOKEN" \
  -H 'content-type: application/json' -d '{ "commit": "…", "findings": [ … ] }'
```

| Method | Endpoint                     | Purpose                                |
| ------ | ---------------------------- | -------------------------------------- |
| GET    | `/api/health`                | Liveness check                         |
| GET    | `/api/overview`              | Aggregate metrics + repo summaries     |
| GET    | `/api/repos`                 | List repositories                      |
| POST   | `/api/repos`                 | Register / update a repository         |
| GET    | `/api/repos/:id`             | Repo detail + review history           |
| GET    | `/api/repos/:id/reviews`     | Reviews for a repo                     |
| POST   | `/api/repos/:id/reviews`     | **Submit a review report**             |
| GET    | `/api/reviews`               | List reviews across repos (trend source) |
| GET    | `/api/reviews/:id`           | Single review (findings + diff)        |
| GET    | `/api/trends`                | Daily new/resolved/review aggregates   |
| GET    | `/api/scan`                  | Current active-run state               |
| PUT    | `/api/scan`                  | Update active-run state                |

### Register a repo

```sh
curl -X POST localhost:3000/api/repos -H 'content-type: application/json' -d '{
  "id": "sapphire-paratime",
  "lang": "Solidity",
  "description": "Confidential EVM ParaTime",
  "path": "oasisprotocol/sapphire-paratime",
  "lines": 19200
}'
```

### Submit a review report

`findings` is the structured form the dashboard renders into the report layout.
`html` is **optional** — a pre-rendered report body that is sanitized
server-side and shown below the structured findings. The diff (new / carried /
resolved) is computed automatically against the repo's previous review.

```sh
curl -X POST localhost:3000/api/repos/sapphire-paratime/reviews \
  -H 'content-type: application/json' -d '{
  "commit": "a3f9c21",
  "trigger": "Scheduled",
  "engine": "slither+semgrep+llm",
  "durationSecs": 231,
  "lines": 19200,
  "filesScanned": 80,
  "findings": [
    {
      "severity": "crit",
      "title": "Reentrancy in withdraw()",
      "file": "contracts/ConfidentialVault.sol",
      "line": 142,
      "cwe": "CWE-841",
      "description": "Balance updated after an external call.",
      "code": "(bool ok,) = msg.sender.call{value: amt}(\"\");\nbal[msg.sender] -= amt;",
      "recommendation": "Apply checks-effects-interactions or a nonReentrant guard."
    }
  ],
  "html": "<h3>Notes</h3><p>Optional narrative…</p>"
}'
```

`severity` is one of `crit` | `high` | `med` | `low`. `commit` and each
finding's `severity` + `title` are required; everything else is optional.

### Read reviews / trends

```sh
# flat review list — the raw material for custom trends (newest first)
curl 'localhost:3000/api/reviews?since=2026-06-01&limit=500'
curl 'localhost:3000/api/reviews?repo=sapphire-paratime'

# pre-aggregated daily buckets: new / resolved / reviews per day
curl 'localhost:3000/api/trends?days=30'
curl 'localhost:3000/api/trends?days=14&repo=sapphire-paratime'
```

`GET /api/reviews` accepts `repo`, `since`/`until` (epoch-ms or ISO-8601), and
`limit` (1..1000, default 200). `GET /api/trends` accepts `days` (1..365,
default 14) and optional `repo`; each bucket is
`{ day, date, newFindings, resolvedFindings, reviews }`.

### Update the active run

```sh
# progress update during a scan
curl -X PUT localhost:3000/api/scan -H 'content-type: application/json' -d '{
  "active": true, "repoId": "sapphire-paratime", "commit": "a3f9c21",
  "currentFile": "contracts/FeeManager.sol", "progress": 62
}'

# clear when finished
curl -X PUT localhost:3000/api/scan -H 'content-type: application/json' -d '{ "active": false }'
```

## Data model

`node:sqlite` tables: `repos`, `reviews`, `findings`, `scan` (singleton live
run), `meta` (cadence, org label, etc.). Findings carry a stable `fingerprint`
(`file` + `title`) so the same issue is tracked run-over-run — that's what powers
the new/carried/resolved diff and per-finding age ("open N runs"). Server data
access lives in `src/lib/server/` (`db.ts`, `store.ts`, `seed.ts`,
`sanitize.ts`, `auth.ts`).
