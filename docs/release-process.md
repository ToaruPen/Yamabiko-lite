# Release Process

This repository is release-ready when the working tree is clean and the full
verification suite passes.

## Preconditions

- run from the repository root
- have Bun 1.3.10 or newer available, or set `BUN_BIN=/path/to/bun`
- have GitHub CLI auth if you plan to publish from a local machine
- ensure `main` contains the intended release contents

## Release Checklist

1. Verify the version and user-facing docs.

    - check `package.json`
    - check `src/index.ts`
    - check `README.md`
    - check `docs/skills/check-inbox.md`
    - check `CHANGELOG.md`
    - check `LICENSE`

2. Run the full local verification suite.

   ```bash
   ./bin/yamabiko-lite --help
   sh ./scripts/bun-exec.sh run check
   sh ./scripts/bun-exec.sh test
   sh ./scripts/bun-exec.sh run build
   ```

3. Update the changelog for the release.

   Add a dated entry in `CHANGELOG.md` that summarizes the user-visible changes
   in the release.

4. Create and push a stable tag.

    ```bash
    git tag v0.1.3
    git push origin v0.1.3
    ```

    Replace `v0.1.3` with the exact version you are publishing.

    The Release workflow will move the floating tags for the same compatibility
    line after the exact tag is pushed. For a tag like `v0.1.3`, that means
    `v0` and `v0.1` will be updated automatically.

5. Confirm the Release workflow succeeds.

   The workflow at `.github/workflows/release.yml` runs `check`, `test`,
   `build`, packages the release archive, and publishes a GitHub release for the
   pushed tag.

   The local verification commands above use `scripts/bun-exec.sh`, which honors
   `BUN_BIN` when set and otherwise falls back to `bun` on `PATH`.

6. Confirm the adoption example references the published tag.

   `README.md` should point to the intended adoption channel:

    - `uses: ToaruPen/Yamabiko-lite@v0` for automatic compatible upgrades
    - `uses: ToaruPen/Yamabiko-lite@v0.1` for automatic patch upgrades within the current minor line
    - `uses: ToaruPen/Yamabiko-lite@<exact-release-tag>` for an exact release pin
    - `uses: ToaruPen/Yamabiko-lite@<commit-sha>` for maximum auditability

   If you update the exact-pin example, keep it aligned with the latest
   published release while leaving `@v0` as the automatic-upgrade example.

## Distributed Skill Template

For repositories that install or vendor the CLI, start from
`docs/skills/check-inbox-template.md` and adapt the escalation rules to the
target repository.

Until the CLI has a packaged distribution path, external repositories should
either vendor the CLI wrapper and source tree or use the reusable action only.
