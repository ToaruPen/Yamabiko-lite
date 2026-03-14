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
- no autonomous fix-and-push loop
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
4. the original authoring agent runs `/check-inbox`
5. fixes are applied with existing context, then pushed
6. review is requested again until merge

## Design Principles

- Keep the human or authoring agent in the loop
- Prefer file-based durability over service infrastructure
- Use stable IDs and head SHA checks to avoid duplicate or stale work
- Treat bot feedback as structured work items, not free-form chat history
- Optimize for low quota and low latency in day-to-day development

## Planned V1

- GitHub Actions workflow for review-event ingestion
- Dedicated inbox branch in the target repository
- JSONL inbox records plus a human-readable Markdown summary per PR
- Local CLI helpers for listing and resolving inbox items
- A `/check-inbox` skill contract for Codex-driven remediation

## Non-Goals For V1

- autonomous background code mutation
- automatic commits and pushes from the ingestion workflow
- cross-repository central service
- database-backed analytics

## Repository Layout

```text
AGENTS.md
README.md
docs/
  implementation-plan.md
```

## Status

This repository currently defines the product scope and implementation plan.
Code comes next.
