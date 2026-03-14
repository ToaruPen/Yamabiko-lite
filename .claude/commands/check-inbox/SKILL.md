---
name: check-inbox
description: >-
  Review and act on Yamabiko-lite inbox items for the current pull request by
  driving the local CLI. Use when the user asks to check inbox items, process
  bot feedback, work through unresolved review findings, or explicitly invokes
  `/check-inbox`. Best for repositories that contain Yamabiko-lite source and an
  open PR on the current branch. Do not use for merge decisions, specification
  disputes, dependency additions, security-sensitive changes, or repositories
  without the local Yamabiko-lite CLI.
---

# /check-inbox

Use the local CLI as the source of truth. Keep the workflow local-first: list,
claim, fix, verify, push, then resolve.

For the human-readable contract, see `docs/skills/check-inbox.md`.

## Preconditions

- Run from the repository root.
- Require `gh` auth, `git`, and `~/.bun/bin/bun`.
- Require an open PR for the current branch, or a user-provided PR number.
- Require Yamabiko-lite source in the repo (`src/cli/main.ts`).

If any precondition fails, stop and explain the missing requirement.

## Do Not Use

- Merge decisions
- Product or specification disputes
- Security-sensitive or permission-changing fixes
- Dependency additions
- Repositories that only use the reusable ingest action and do not have the CLI

Escalate those cases to the human instead of resolving the inbox item.

## Workflow

1. Discover the active PR.

   ```bash
   gh pr view --json number,headRefName,url
   ```

   If this fails, ask for the PR number or ask the user to check out the PR
   branch.

2. List actionable inbox items for the PR.

   ```bash
   ~/.bun/bin/bun run src/cli/main.ts inbox list --pr <PR_NUMBER> --json
   ```

   Default behavior already excludes stale items. Focus on `pending` items
   first. Treat `claimed` as in-progress and avoid taking ownership unless the
   user wants you to continue that work.

3. Triage before acting.

   - Fix directly: localized implementation bugs, test failures, lint/type
     issues, narrow refactors, bounded inline suggestions
   - Escalate: ambiguous product intent, API contract changes, dependency
     additions, security or permission changes

4. Claim one item before editing.

   ```bash
   ~/.bun/bin/bun run src/cli/main.ts inbox claim <ITEM_ID> --pr <PR_NUMBER>
   ```

   Omit `--repo` unless repo inference fails.

5. Implement the fix in the current working branch.

   - Read the referenced code and surrounding context
   - Apply the smallest safe fix
   - Follow repository rules from `AGENTS.md`

6. Verify before resolving.

   Run the smallest relevant checks first, then broader ones if needed. Typical
   order:

   ```bash
   ~/.bun/bin/bun run format:check
   ~/.bun/bin/bun run lint
   ~/.bun/bin/bunx tsc --noEmit
   ~/.bun/bin/bun test
   ```

   If the repository uses a different test stack, run the repo-native checks.

7. Commit and push the fix when appropriate.

   Do not mark an item as `fixed` until the code change is committed and pushed.

8. Resolve the inbox item.

   ```bash
   ~/.bun/bin/bun run src/cli/main.ts inbox resolve <ITEM_ID> --pr <PR_NUMBER> --status fixed
   ```

   Use `--status skipped` only when the item is consciously not being fixed and
   the rationale is clear from the session context.

## Failure Handling

- If list/claim/resolve fails on JSONL integrity checks, stop and inspect the
  inbox branch rather than rewriting records blindly.
- If claim succeeds but the implementation is blocked, leave the item claimed
  and explain the blocker.
- If verification fails, do not resolve the item.

## Output Contract

When using this command, return:

- the PR being processed
- the selected inbox item ids
- what was fixed or why it was escalated
- what verification ran and whether it passed
- which items were resolved or intentionally left open
