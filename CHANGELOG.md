# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic
Versioning for published releases.

## [Unreleased]

### Changed

- prepare the next release line as `0.1.3` in the source tree
- add a timeout to the review-ingest workflow and adoption example
- document current GitHub.com, non-fork, and CLI distribution boundaries more clearly
- add `SECURITY.md` and formalize release checklist expectations for changelog updates
- add an explicit MIT license for public distribution

## [0.1.2] - 2026-03-14

### Changed

- harden inbox isolation for mixed repository, branch, and worktree usage
- preserve legacy inbox paths while normalizing repository identifiers
- add local mutation locking for `claim` and `resolve`
- prune stale worktrees before inbox worktree creation

## [0.1.1] - 2026-03-14

### Changed

- improve release and adoption documentation
- add floating tags for `v0` and `v0.1`

## [0.1.0] - 2026-03-14

### Added

- initial reusable GitHub Action for review-event ingestion
- inbox JSONL and Markdown storage on a dedicated inbox branch
- local CLI commands for `inbox list`, `claim`, and `resolve`
- repo-local `/check-inbox` workflow contract and skill template
