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
One security problem in a repository, identified by its fingerprint and possibly present at several locations.
_Avoid_: vulnerability, bug, alert

**Finding**:
One report of an issue at one location in one review.
_Avoid_: hit, result

**Issue prompt**:
The instructions plus issue data a human copies into a coding agent so it verifies the issue and proposes a fix for approval.
_Avoid_: fix prompt, agent prompt
