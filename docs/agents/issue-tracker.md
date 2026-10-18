# Issue tracker: GitHub + beads (hybrid)

Two tiers:

- **GitHub Issues** (`gh` CLI): the larger unit (features, specs, bug reports, requests, wayfinder maps). Shared, durable, visible on the remote.
- **beads** (`bd` CLI, `.beads/`): the steps that implement a GitHub issue. `.beads/` is git-excluded, so bd issues exist on this machine only. Anything other people need to see goes on the GitHub issue.

Link: each GitHub issue being worked gets one bd `epic` with `--external-ref gh-<N>`; every step is a child of that epic.

## GitHub conventions (big units)

- **Create**: `gh issue create --title "..." --body "..."` (heredoc for multi-line bodies).
- **Read**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with `--label` / `--state` filters.
- **Comment**: `gh issue comment <number> --body "..."`
- **Labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`, or a merged PR with `Closes #<number>`.

Infer the repo from `git remote -v`; `gh` does this automatically inside a clone.

## beads conventions (steps)

- **Epic for a GitHub issue**: `bd create "<GH title>" -t epic --external-ref gh-<N> -d "See #<N>"`. Before creating, check whether one already exists: `bd list --type epic --json | jq '.[] | select(.external_ref=="gh-<N>")'`.
- **Step**: `bd create "<title>" -t task|bug|chore --parent <epic-id> -l <area labels> -d "..."`. Area labels follow existing usage (`frontend`, `api`, `db`, `security`, `testing`, ...).
- **Blocking**: `bd dep add <blocked-id> --blocked-by <blocker-id>`.
- **Read / list**: `bd show <id>`, `bd list --parent <epic-id> --json`.
- **Next step**: `bd ready --parent <epic-id>`.
- **Claim**: `bd update <id> --claim`.
- **Comment**: `bd comment <id> "..."`.
- **Close**: `bd close <id>`.
- **Roll up**: when every child of an epic is closed, close the epic, then close the GitHub issue (PR `Closes #N`, or `gh issue close <N> --comment "<summary>"`).

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`, then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

- A spec, feature, bug report, or anything another person should see → **GitHub issue**.
- Breaking a GitHub issue into tickets/steps (`to-tickets`) → **bd children** under that issue's epic (create the epic first if missing).
- A small step with no parent GitHub issue → standalone bd issue.

## When a skill says "fetch the relevant ticket"

- `#<N>` or a GitHub URL → `gh issue view <N> --comments`, plus `bd list --parent <epic-id>` if an epic with `external_ref gh-<N>` exists.
- A bd id (e.g. `hsd-a0m.13`) → `bd show <id>`. Steps carry no external ref; the link lives on the epic. Walk up `.parent` (`bd show <id> --json | jq -r '.[0].parent // empty'`) until you reach an issue with an `external_ref` of `gh-<N>`, then also read that GitHub issue. If there is no parent and no external ref, it's a standalone bd ticket: `bd show` is the whole context.

## Triage

Triage applies to **GitHub issues** only; bd steps are created already triaged.

## Wayfinding operations

Used by `/wayfinder`. The **map** lives on GitHub; its **child** tickets live in bd.

- **Map**: a GitHub issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body (`gh issue create --label wayfinder:map`), plus a bd epic with `--external-ref gh-<map>`.
- **Child ticket**: `bd create "<title>" --parent <map-epic> -l wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`).
- **Blocking**: `bd dep add <child> --blocked-by <blocker>`. A ticket is unblocked when every blocker is closed.
- **Frontier query**: `bd ready --parent <map-epic>`; first in priority/creation order wins.
- **Claim**: `bd update <id> --claim`, the session's first write.
- **Resolve**: `bd comment <id> "<answer>"`, `bd close <id>`, then append a gist to the GitHub map's Decisions-so-far (`gh issue edit <map> --body-file -`), since bd isn't visible remotely.
