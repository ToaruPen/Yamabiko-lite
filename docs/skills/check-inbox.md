# /check-inbox Contract

`/check-inbox` is the operator workflow for processing Yamabiko-lite inbox items
inside the original implementation context.

The executable repo-local command lives at:

- `.claude/commands/check-inbox/SKILL.md`

## Preconditions

- run from the repository root
- have `gh`, `git`, and `~/.bun/bin/bun` available
- have an open PR for the current branch, or a user-provided PR number
- have the local Yamabiko-lite CLI available in the repo

## Command Sequence

1. Discover the active PR:

   ```bash
   gh pr view --json number,headRefName,url
   ```

2. List inbox items for the PR:

   ```bash
   ~/.bun/bin/bun run src/cli/main.ts inbox list --pr <PR_NUMBER> --json
   ```

3. Claim one item before editing:

   ```bash
   ~/.bun/bin/bun run src/cli/main.ts inbox claim <ITEM_ID> --pr <PR_NUMBER>
   ```

4. Fix the code in the current branch and run repository-native verification.

5. Resolve after the fix is committed and pushed:

   ```bash
   ~/.bun/bin/bun run src/cli/main.ts inbox resolve <ITEM_ID> --pr <PR_NUMBER> --status fixed
   ```

Use `--status skipped` only when the session intentionally does not fix the
item and the rationale is clear.

## Default Triage Rules

Fix directly when the item is clearly:

- a localized implementation bug
- a lint, type, or test issue
- a narrow refactor inside existing design boundaries
- a bounded inline review suggestion

Escalate to the human when the item implies:

- a product or specification dispute
- a meaningful architecture or API contract change
- a dependency addition or permission expansion
- a security-sensitive change
- conflict with documented intent

## Safety Rules

- do not mark an item as `fixed` until the code is pushed
- do not resolve items if verification is failing
- if JSONL integrity checks fail, stop and inspect the inbox branch instead of
  rewriting records blindly
