# Security Policy

## Supported Versions

Yamabiko-lite is currently maintained as a single active `main` line plus the
latest published `v0` release series.

- `main`: supported for active development and follow-up fixes
- latest `v0.x.y` release: supported for reusable-action adopters
- older releases: unsupported once a newer `v0.x.y` release is published

## Reporting a Vulnerability

Please do not open a public GitHub issue for suspected security problems.

Instead:

1. Open a GitHub Security Advisory draft for this repository if you have access.
2. If you do not have access, contact the repository owner privately on GitHub
   and include:
   - a description of the issue
   - affected versions or refs
   - reproduction steps
   - potential impact
   - any suggested mitigation

We will acknowledge valid reports as quickly as possible, reproduce the issue,
and coordinate a fix and disclosure plan before publishing details.

## Scope Notes

The highest-risk areas in this repository are:

- GitHub token handling in `action.yml`
- inbox branch writes and worktree management in `src/actions/branch.ts`
- GitHub API ingestion in `src/actions/ingest.ts` and `src/api/github.ts`
- local mutation locking in `src/cli/inbox-lock.ts`
