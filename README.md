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
bun run test           # vitest run (Node runtime, in-memory DB)
bun run check          # svelte-check type verification

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

## Testing

Tests run under **Node** via Vitest with `HERMES_DB=':memory:'`:

```sh
bun run test
```

Each test file gets an isolated in-memory SQLite database. For resetting database state between test cases or invoking API route handlers directly, `tests/test-utils.ts` provides:
- `resetDb()`: truncates tables and restores default singleton rows (`scan`, `meta`).
- `callApi(handler, options)`: calls route handlers with a minimal `RequestEvent` object, parses JSON responses, and handles `@sveltejs/kit` `HttpError`s.

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
| `HERMES_SEED_DEMO` | `false` (prod) / `true` (dev) | Seed demo data on an empty DB; in dev on by default, set `true` in production to seed |
| `HERMES_DB_SNAPSHOT` | `${HERMES_DB}.snapshot` | Snapshot file the sync layer copies |
| `HERMES_SNAPSHOT_INTERVAL` | `300` | Seconds between snapshot/checkpoint cycles |
| `BASE_PATH` | `''` | Sub-path prefix — **build arg**, baked at build time |

## Pages

| Route                          | What                                                        |
| ------------------------------ | ---------------------------------------------------------- |
| `/`                            | Overview — compact severity strip, needs attention, scan status, risk-sorted repo table with search + status/severity filters |
| `/repo/[id]`                   | Repo detail — metric summary, live scan banner, review history |
| `/repo/[id]/review/[reviewId]` | Review report — severity band, summary, diff vs previous run, findings with code + remediation, resolved section |

UI pages read directly from the database via server `load`. The active-run
banner polls `GET /api/scan`, which returns the live scan state along with
`dataVersion`. The client polls using a backoff-aware timer chain, pauses when
hidden, and triggers `invalidateAll()` whenever `dataVersion` advances.

Times are formatted in the browser: absolute times in its local time zone (hover
one for the full date and zone name), relative ones ("2h 14m ago", "in 3h") on a
shared 30-second clock, so they stay current without a reload. Server-rendered
HTML shows UTC times until the page hydrates.

The overview puts repositories with open critical or high findings in **Needs
attention**. Its repository table (and `GET /api/repos` / the overview's `repos`
array) defaults to highest open severity, then critical/high issue count, then
oldest open issue. Column-header buttons change the table sort. **Oldest open**
uses `RepoSummary.oldestOpenAt`: the earliest first-seen epoch-ms among unresolved
critical/high issues in the head-commit union, across every model and location.
False-positive and accepted-risk triage are excluded; acknowledged issues remain
open. The field is `null` when no open critical/high issues remain. Language tags
are neutral text so they cannot be confused with severity.

## Agent API

A machine-readable **OpenAPI 3.1** spec lives at
[`src/lib/server/openapi.yaml`](src/lib/server/openapi.yaml). The app serves it
and renders browsable docs:

- **`/docs`** — rendered API reference ([Scalar](https://github.com/scalar/scalar)).
- **`/openapi.yaml`** — the raw spec.
- **`/api/openapi.json`** — the spec as JSON, for codegen/tooling.

(Under a sub-path deploy each sits beneath the base path, e.g. `/security/docs`.)
The tables below mirror the spec, and a contract test checks the read responses
against it.

Base path `/api`. Reads are open; **writes** honour `HERMES_API_TOKEN` if set
(`Authorization: Bearer <token>`), otherwise are unauthenticated. Read responses
carry raw values, not display strings: timestamps are epoch-ms (`createdAt`,
`lastRunAt`, `nextRunAt`) and durations are seconds (`durationSecs`,
`lastDurationSecs`, `avgScanSecs`); formatting is up to the client.

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
| GET    | `/api/repos/:id/rerun`       | Check re-run request state (not consumed) |
| POST   | `/api/repos/:id/rerun`       | Record re-run request (not consumed)   |
| GET    | `/api/reviews`               | List reviews across repos (trend source) |
| GET    | `/api/reviews/:id`           | Single review (findings + diff)        |
| GET    | `/api/trends`                | Daily new/resolved/review aggregates   |
| GET    | `/api/scan`                  | Current active-run state + dataVersion |
| PUT    | `/api/scan`                  | Update active-run state                |
| PUT    | `/api/repos/:id/findings/:fingerprint/triage` | Set or clear finding triage verdict |

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

A new `id` must be a single URL path segment matching `^[A-Za-z0-9._-]{1,100}$`
(and not `.` or `..`); anything else is a 400. Repos registered before this rule
keep working and can still be updated under their old id. `lines` must be a
non-negative integer.

### Submit a review report

`findings` is the structured form the dashboard renders into the report layout.
`html` is **optional** — a pre-rendered report body that is sanitized
server-side and shown below the structured findings. The diff (new / carried /
resolved) is a property of the commit: only a commit's first scan carries a delta
(computed against the previous commit's unioned findings), and re-scans of the same
commit report a zero delta — so re-scanning one commit never fabricates churn.

```sh
curl -X POST localhost:3000/api/repos/sapphire-paratime/reviews \
  -H 'content-type: application/json' -d '{
  "commit": "a3f9c21",
  "model": "claude-opus-4-8",
  "trigger": "Scheduled",
  "engine": "slither+semgrep+llm",
  "durationSecs": 231,
  "lines": 19200,
  "filesScanned": 80,
  "agentVersion": "hermes-agent 1.4.2",
  "nextRunAt": "2026-06-18T18:00:00Z",
  "findings": [
    {
      "severity": "crit",
      "title": "Reentrancy in withdraw()",
      "file": "contracts/ConfidentialVault.sol",
      "line": 142,
      "ruleId": "reentrancy-eth",
      "locationKey": "ConfidentialVault.withdraw",
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
finding's `severity` + `title` are required; everything else is optional. The
numeric fields (`durationSecs`, `lines`, `filesScanned`, a finding's `line`) must
be non-negative integers, and `findings`, when present, must be an array. A
malformed body is a 400 and stores nothing.

`model`, `engine`, `trigger` and `agentVersion` are stored as sent; one the agent
leaves out is stored empty, never a guessed value (the report shows "—" for an
empty `engine`/`trigger` and omits an empty `model`/`agentVersion`). Without a
`summary`, the report shows a one-line summary built from the review's own data
(issue counts by severity, files, engine, model).

Every finding is stored. Findings that share an **identity** (see
[Finding identity](#finding-identity)) are one issue with several locations, shown
as e.g. "2 locations: L88, L140"; only exact duplicates (same identity at the same
line + `locationKey`) collapse, keeping the most severe.

A commit can be scanned more than once — LLM reviews are non-deterministic, and you
may run several models against the same code. Submits are therefore idempotent on
scan **content**, not on `(repo, commit)`. The content key is `commit` + `model` +
`engine` + the issue set, where each issue contributes only its identity and most
severe `severity` (the same identity used for the new/carried/resolved diff). A
resubmit with the same key returns the existing review (`duplicate: true`, HTTP 200);
a re-run that finds a different issue, drops one, changes a severity, or runs a
different `model` is stored as its own review. Note the key ignores a finding's
`line`/`description`/`recommendation`/`code`, so a retry that only rewords those (or
moves a line) dedups to the first report. Each scan shows up as its own row, newest
first, with its `model`. A repo's headline status unions the issues across **all**
scans of its current commit, so an issue one model flagged isn't hidden because a
later model missed it.

`nextRunAt` (epoch-ms or ISO-8601; 10-digit epoch seconds are rejected with 400)
tells the dashboard when the agent plans to run next; it's rendered as **Next
run** on the overview. The schedule is agent-driven — there is no fixed cadence.
The dashboard shows "unscheduled" until the agent first reports a value. The last
reported next run then **persists**: omitting `nextRunAt` on a later submit keeps
the previous value, and sending `nextRunAt: 0` clears it back to "unscheduled".

### Agent payload contract

What the Hermes agent's scheduled review task must put in each review it posts,
beyond the required `commit` and per-finding `severity` + `title`. Give this list
to the task prompt verbatim:

- **`agentVersion`** (review): the agent's own version string, e.g.
  `hermes-agent 1.4.2`. Send it on every review.
- **`ruleId`** (each finding): the id of the tool rule or detector that raised
  the finding, copied exactly from the tool output: a slither detector name
  (`reentrancy-eth`), a semgrep `check_id`, etc. Omit it when no tool raised the
  finding (an LLM-only observation); don't invent ids.
- **`locationKey`** (each finding): the function or symbol that contains the
  finding, e.g. `ConfidentialVault.withdraw`, `crate::vault::withdraw`,
  `(*Server).Handle`. Name the symbol, not the line: lines shift between commits,
  the symbol doesn't. Omit it for file-level findings (pragma, config).

`ruleId` + `file` + `locationKey` become the finding's identity (see below), so
the same issue must get the same values on every run.

Each is a string of at most 200 characters after trimming; a wrong type or a
longer value is a 400. All three are optional, and payloads without them keep
working.

### Finding identity

Each finding gets an identity, the `fingerprint` the new/carried/resolved diff,
the counts, the commit union and triage tags all key on:

- **With a `ruleId`**: `ruleId` + `file` + `locationKey`. The title is not part of
  it, so an LLM rewording a title between runs, or the code moving down a few
  lines, keeps the issue (and its triage tag). The same rule in two functions is
  two issues; the same rule twice in one function, or twice in a file without a
  `locationKey`, is one issue with two locations.
- **Without a `ruleId`**: `file` + `title`, the key every finding had before these
  fields existed. Old findings and their triage tags keep their keys; nothing is
  re-keyed. A `locationKey` alone is shown but doesn't split issues.

Each component is trimmed and compared case-insensitively. When the agent starts
sending `ruleId`, those findings move to new identities once: on that commit they
show as new, the old file + title issues as resolved, and earlier triage tags don't
carry over to them (re-tag the ones that still apply).

### Read reviews / trends

```sh
# flat review list — the raw material for custom trends (newest first)
curl 'localhost:3000/api/reviews?since=2026-06-01&limit=500'
curl 'localhost:3000/api/reviews?repo=sapphire-paratime'

# pre-aggregated daily buckets: new / resolved / reviews per day
curl 'localhost:3000/api/trends?days=30'
curl 'localhost:3000/api/trends?days=14&repo=sapphire-paratime'
```

`GET /api/reviews` accepts `repo`, `since`/`until`, and `limit` (1..1000, default
200). `GET /api/trends` accepts `days` (1..365, default 14) and optional `repo`;
each bucket is `{ day, date, newFindings, resolvedFindings, reviews }`.

`since`/`until` take epoch-ms (12+ digits), a 4-digit year (`2024` = Jan 1 2024,
UTC), or ISO-8601. A 10-digit value is epoch seconds and is rejected with 400
rather than being read as a date in January 1970.

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

While `active` is true, `repoId` must name a registered repo (the banner links to
it); an unknown one is a 400. `progress` is an integer, clamped to 0–100;
`startedAt` is integer epoch-ms; `repoId`/`commit`/`currentFile`/`engine` are
strings (or null). A field of the wrong type is a 400.

### Triage a finding

```sh
curl -X PUT localhost:3000/api/repos/sapphire-paratime/findings/8d2b.../triage \
  -H 'content-type: application/json' \
  -H 'x-hermes-user: 0x1234...abcd' \
  -d '{"status": "false_positive", "note": "Guarded by nonReentrant modifier"}'
```

Triage verdicts (`acknowledged`, `false_positive`, `accepted_risk`, or `open`/null to clear)
attach to a finding's stable `(repo, fingerprint)` identity and persist across agent re-runs.
`false_positive` and `accepted_risk` quiet the finding from headline severity counts.

**Attribution:** The endpoint inspects the `x-hermes-user` header, set by the wallet gateway
from the signed-in session address. The dashboard trusts this header because only whitelisted
users reach it through the gateway. If missing or blank, `unknown` is stored.

**Validation:** Triaging a critical or high finding as `false_positive` or `accepted_risk`
**requires** a non-empty `note` justification (returns HTTP 400 if missing or whitespace).

### Re-run requests

The endpoints `GET /api/repos/:id/rerun` and `POST /api/repos/:id/rerun` record and inspect re-run requests. Note that requests are never cleared and are currently not consumed by the agent.

## Data model

`node:sqlite` tables: `repos`, `reviews`, `findings`, `scan` (singleton live
run), `meta` (`data_version`, next run, org label, etc.). SQLite triggers increment
`meta.data_version` on every write (repo, review, triage, or scan state transition).
Each finding row is one location of an issue; rows of the same issue share a stable
`fingerprint` (its [identity](#finding-identity)) so the issue is tracked run-over-run —
that's what powers the new/carried/resolved diff and per-finding age ("open N runs"). Server data
access lives in `src/lib/server/`: `db.ts` (connection) and `migrations.ts` (versioned
schema), one module per domain (`repos.ts`, `commits.ts`, `reviews.ts`, `ingest.ts`,
`triage.ts`, `overview.ts`, `trends.ts`, `scan.ts`, `meta.ts`), plus `seed.ts`,
`durability.ts`, `sanitize.ts` and `auth.ts`.
