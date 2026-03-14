# Yamabiko-lite Implementation Plan

## Product Definition

Yamabiko-lite is a lightweight remediation loop for PR review bots.

It does not try to fix code inside an isolated worker that has lost the
original implementation context. Instead, it stores review feedback in a
durable inbox and lets the authoring session pull the next actionable item when
it is ready.

## Desired Outcome

The system should make the following workflow routine:

1. A developer or agent opens a PR.
2. Review bots such as CodeRabbit or Copilot leave feedback.
3. A GitHub Actions workflow turns that feedback into inbox records.
4. The authoring session runs `/check-inbox`.
5. The session receives unresolved feedback items for the current PR and head
   SHA.
6. The session fixes or consciously skips each item.
7. The session pushes changes and requests review again.

## V1 Scope

### In Scope

- capture `pull_request_review`, `pull_request_review_comment`, and
  `issue_comment` events
- normalize supported bot feedback into a stable inbox schema
- deduplicate records by source event identity
- store inbox data in the target repository on a dedicated branch
- expose a deterministic read path for `/check-inbox`
- support item states such as `pending`, `claimed`, `fixed`, and `skipped`
- record the `headSha` seen when feedback was produced

### Out of Scope

- autonomous patch generation in the ingestion workflow
- containerized fix execution from the workflow
- automatic commits and pushes after reading the inbox
- background daemons, queues, or databases

## Core Architecture

### 1. Event Ingestion

A GitHub Actions workflow runs on review-related events and executes a small
normalizer script.

Responsibilities:

- validate event type and action
- ignore non-bot feedback by policy
- extract stable identifiers such as `commentId`, `reviewId`, `commentUrl`,
  `repository`, `pullRequestNumber`, and `headSha`
- build one inbox record per actionable item
- upsert that record onto the inbox branch

### 2. Durable Storage

Inbox records live on a dedicated branch in the target repository:

- branch name: `yamabiko-lite-inbox`
- machine-readable records:
  `.yamabiko-lite/inbox/<owner>/<repo>/pr-<number>.jsonl`
- human-readable summary:
  `.yamabiko-lite/inbox/<owner>/<repo>/pr-<number>.md`

Rationale:

- no noise on the default branch
- inspectable and versioned with plain Git
- easy for local tools and skills to read
- no service dependency for MVP

### 3. Consumption

The `/check-inbox` skill or a local CLI reads the current repository inbox and
filters items by:

- matching repository
- PR number
- unresolved status
- current head SHA compatibility

The consumer then presents an ordered worklist to the active session.

### 4. Resolution

After a fix or explicit skip, the consumer updates the matching inbox item:

- `status: fixed` when a fix was applied and pushed
- `status: skipped` when the session chose not to fix it
- `status: stale` when the stored head SHA no longer matches the PR head

This update happens explicitly from the authoring session, not from the
ingestion workflow.

## Inbox Record Schema

Each JSONL line should follow this shape:

```json
{
  "id": "github-review-comment-123456789",
  "source": "github",
  "eventType": "pull_request_review_comment",
  "repository": {
    "owner": "OWNER",
    "name": "REPO"
  },
  "pullRequestNumber": 42,
  "commentUrl": "https://github.com/OWNER/REPO/pull/42#discussion_r123456789",
  "commentId": 123456789,
  "reviewId": 987654321,
  "botLogin": "coderabbitai",
  "body": "Please simplify this branch and avoid duplicate parsing.",
  "path": "src/foo.ts",
  "line": 120,
  "headSha": "abc123",
  "status": "pending",
  "createdAt": "2026-03-14T00:00:00.000Z",
  "updatedAt": "2026-03-14T00:00:00.000Z"
}
```

## Deduplication Rules

Use the most stable source identity available:

- review comment: `commentId`
- review: `reviewId`
- issue comment on PR: `commentId`

If an identical item already exists, update `updatedAt` and preserve the latest
body and `headSha`.

## State Model

Allowed statuses for v1:

- `pending`
- `claimed`
- `fixed`
- `skipped`
- `stale`

Rules:

- ingestion only creates or refreshes `pending`
- `/check-inbox` may mark `claimed`
- resolution commands may mark `fixed`, `skipped`, or `stale`

## GitHub Actions Design

### Workflow Trigger

Use these events:

- `pull_request_review`
- `pull_request_review_comment`
- `issue_comment`

Filter further in script logic:

- only supported actions
- only PR-related issue comments
- only configured bot logins

### Permissions

Minimum expected permissions:

- `contents: write` for inbox-branch updates
- `pull-requests: read`

Fork PR support should be treated as a separate phase because token permissions
and trust boundaries are stricter there.

## CLI and Skill Contract

V1 should provide a local command surface such as:

- `yamabiko-lite inbox list`
- `yamabiko-lite inbox claim <id>`
- `yamabiko-lite inbox resolve <id> --status fixed`
- `yamabiko-lite inbox resolve <id> --status skipped`

The `/check-inbox` skill should:

1. detect the current repository and PR
2. load unresolved inbox items
3. filter out stale records
4. present the next highest-signal items first
5. mark items as resolved after the session acts

## Suggested Implementation Order

### Phase 1: Documentation and schema

- finalize inbox schema
- finalize branch and path conventions
- define bot allowlist config shape

### Phase 2: Ingestion workflow

- add workflow YAML
- add normalizer/upsert script
- verify branch creation and idempotent updates

### Phase 3: Read path

- implement local CLI for listing inbox items
- implement stale-head filtering
- generate Markdown summaries

### Phase 4: Resolution path

- implement claim and resolve commands
- update JSONL and Markdown summaries
- define how `/check-inbox` calls the CLI

### Phase 5: Optional extensions

- repeated finding classification similar to Yamabiko
- skip rationale capture
- cycle grouping across review rounds
- inbox analytics

## Success Criteria

The MVP is successful when:

- a bot review comment reliably produces an inbox record
- duplicate deliveries do not create duplicate work items
- the authoring session can read pending items without reloading unrelated
  repository context
- resolved items stop reappearing in the active inbox
- the workflow stays understandable without server infrastructure

## Open Questions

- whether inbox updates should be committed directly or batched
- whether Markdown summaries should be generated from JSONL or stored directly
- whether fork PR support is needed in v1
- whether `/check-inbox` should be implemented as a Codex skill first or a CLI
  first
