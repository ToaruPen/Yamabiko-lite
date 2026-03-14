# /check-inbox Template

Use this template in repositories that have the `yamabiko-lite` CLI available on
`PATH`.

## Preconditions

- run from the repository root
- have `gh` auth and `git` available
- have `yamabiko-lite` installed and available on `PATH`
- have an open PR for the current branch, or a user-provided PR number

## Command Sequence

1. Discover the active PR.

   ```bash
   gh pr view --json number,headRefName,url
   ```

2. List inbox items for the PR.

   ```bash
   yamabiko-lite inbox list --pr <PR_NUMBER> --json
   ```

3. Claim one item before editing.

   ```bash
   yamabiko-lite inbox claim <ITEM_ID> --pr <PR_NUMBER>
   ```

4. Fix the code in the current branch and run repository-native verification.

5. Resolve after the fix is committed and pushed.

   ```bash
   yamabiko-lite inbox resolve <ITEM_ID> --pr <PR_NUMBER> --status fixed
   ```

Use `--status skipped` only when the session intentionally does not fix the
item and the rationale is clear.
