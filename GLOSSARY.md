# Hermes Security Dashboard

Stores and renders the security reviews an automated reviewer pushes for each repository, and lets humans triage what it found.

## Language

### Agents

**Hermes agent**:
The automated reviewer that scans a repository on its own schedule and submits reviews to the dashboard.
_Avoid_: agent (unqualified), scanner, bot

**Coding agent**:
An AI coding assistant (e.g. Claude Code, Codex), working in a local or cloud checkout, that a human hands an issue to for verification and fixing.
_Avoid_: agent (unqualified), fixer

### Review results

**Issue**:
One security problem in a repository, identified by its canonical, repo-scoped `issueId` and possibly reported under several raw fingerprints and at several locations. Without an explicit alias, its `issueId` equals its fingerprint.
_Avoid_: vulnerability, bug, alert

**Finding**:
One report of an issue at one location in one review.
_Avoid_: hit, result

**Raw fingerprint**:
The immutable, computed identity of a reported group: normalized `ruleId` + `file` + `locationKey`, or the legacy `file` + `title` identity when no rule is supplied. Review findings remain grouped and counted by this identity; a canonical association does not rewrite it or the reported locations.

**Canonical issue ID**:
The existing repository-local root fingerprint to which explicitly associated raw fingerprints resolve. Commit unions and their current-derived transitions use this identity; stored discovery snapshots do not change when an alias is added.

**Issue alias**:
An explicit, audited association from a raw fingerprint to a canonical root in the same repository. Its reason, creation time, actor and supporting review IDs record why continuity was asserted. It is not a fuzzy match or a migration of historical findings. Conflicting human triage requires manual reconciliation, not an automatic merge.

**Continuity evidence**:
The review submitter's nonblank explanation for associating a finding with a different existing `issueId`. Ingest records the resulting alias as `review-submission`, with the resulting review ID and prior root references; this actor is not a claim of human approval.

**Novelty reason**:
An optional nonblank explanation of why a reported finding should be considered distinct. It is retained as submitted context, not a command to rewrite historical identity.

**Issue prompt**:
The instructions plus issue data a human copies into a coding agent so it verifies the issue and proposes a fix for approval.
_Avoid_: fix prompt, agent prompt
