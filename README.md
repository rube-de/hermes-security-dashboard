# Hermes Security Dashboard

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
`HERMES_API_TOKEN` (optional write auth).

Drive the live UI like the real agent would:

```sh
HERMES_URL=http://localhost:5173 node scripts/simulate-scan.mjs sapphire-paratime
```

## Pages

| Route                          | What                                                        |
| ------------------------------ | ---------------------------------------------------------- |
| `/`                            | Overview — totals by severity, run strip, trend, repo list with search + status/severity filters |
| `/repo/[id]`                   | Repo detail — metric summary, live scan banner, review history |
| `/repo/[id]/review/[reviewId]` | Review report — severity band, summary, diff vs previous run, findings with code + remediation, resolved section |

UI pages read directly from the database via server `load`. The active-run
banner additionally polls `GET /api/scan` so the agent's progress shows live.

## Agent API

Base path `/api`. Reads are open; **writes** honour `HERMES_API_TOKEN` if set
(`Authorization: Bearer <token>`), otherwise are unauthenticated.

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
