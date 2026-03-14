# Yamabiko-lite

Lightweight inbox-driven PR remediation for AI review bots.

## Goal

Yamabiko-lite captures bot review feedback into a durable inbox and lets the
same authoring agent or developer resolve it with the original implementation
context still intact.

The v1 system is intentionally simpler than Yamabiko:

- no always-on webhook server
- no database
- no queue worker
- no autonomous background fix-and-push loop
- yes to durable inbox records
- yes to repeated review-cycle tracking
- yes to stale-head-aware triage

## Why

Full autonomous remediation is expensive when the fixing session has already
ended and the new executor must reload repository context from scratch.
Yamabiko-lite optimizes for the opposite workflow:

1. PR is created
2. review bots leave feedback
3. GitHub Actions stores normalized feedback into an inbox
4. the original authoring agent runs `/check-inbox` or receives "check it"
5. the agent fixes, tests, commits, and pushes with existing context
6. review is requested again until merge

## Design Principles

- Keep the human or authoring agent in the loop
- Prefer file-based durability over service infrastructure
- Use stable IDs and head SHA checks to avoid duplicate or stale work
- Treat bot feedback as structured work items, not free-form chat history
- Optimize for low quota and low latency in day-to-day development
- Reserve human attention for specification decisions and merge decisions

## Current Status

V1 is implemented and merged on `main`.

- GitHub Actions review-event ingestion is implemented
- Dedicated inbox branch storage is implemented
- JSONL records plus Markdown summaries are implemented
- Local CLI commands (`inbox list`, `claim`, `resolve`) are implemented
- A repo-local `/check-inbox` command skill is implemented
- Strict validation, retry, stale-head filtering, and integrity guards are in place

The remaining gap is distribution: making the ingestion workflow easy to adopt
from other repositories without copying this repository's source tree by hand.

## Use In Another Repository

The current adoption path is a reusable GitHub Action.

Add a workflow like this to the target repository:

```yaml
name: Review Event Ingestion

on:
  pull_request_review:
    types: [submitted, dismissed]
  pull_request_review_comment:
    types: [created, edited]
  issue_comment:
    types: [created, edited]

jobs:
  ingest:
    runs-on: ubuntu-latest
    if: github.event.sender.type == 'Bot' && (github.event_name != 'issue_comment' || github.event.issue.pull_request != null)
    permissions:
      contents: write
      issues: read
      pull-requests: read
    concurrency:
      group: inbox-write-${{ github.repository }}
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4
      - uses: ToaruPen/Yamabiko-lite@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          bot-allowlist: coderabbitai[bot],github-copilot[bot]
          inbox-branch: yamabiko-lite-inbox
```

Notes:

- `actions/checkout` is required before the action runs because Yamabiko-lite
  operates on the caller repository worktree.
- The action writes only to the inbox branch; it never mutates the PR branch.
- The CLI remains local-first. The reusable action solves ingestion and storage,
  not autonomous fixing.

## Non-Goals For V1

- autonomous background code mutation without an active authoring session
- automatic commits and pushes from the ingestion workflow itself
- cross-repository central service
- database-backed analytics

## Operating Model

- GitHub Actions acts as a non-mutating inbox writer
- The authoring agent acts as the mutating executor after `/check-inbox`
- Humans should only need to intervene for root specification questions,
  policy-level tradeoffs, or final merge decisions

## Repository Layout

```text
AGENTS.md
README.md
action.yml
.claude/commands/check-inbox/SKILL.md
src/
.github/workflows/
docs/
  skills/check-inbox.md
  implementation-plan.md
```

## Next Phase

The next phase is broader adoption hardening:

- publish a stable tagged release for `uses: ToaruPen/Yamabiko-lite@<tag>`
- package or distribute the `/check-inbox` skill beyond this repository
- revisit CLI packaging after the reusable-action path is stable
