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
   - check `README.md`
   - check `docs/skills/check-inbox.md`

2. Run the full local verification suite.

   ```bash
   ./bin/yamabiko-lite --help
   bun run check
   bun test
   bun run build
   ```

3. Create and push a stable tag.

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. Confirm the Release workflow succeeds.

   The workflow at `.github/workflows/release.yml` runs `check`, `test`,
   `build`, packages the release archive, and publishes a GitHub release for the
   pushed tag.

5. Confirm the adoption example references the published tag.

   `README.md` should point to the tag that was just released, such as
   `uses: ToaruPen/Yamabiko-lite@v0.1.0`.

## Distributed Skill Template

For repositories that install or vendor the CLI, start from
`docs/skills/check-inbox-template.md` and adapt the escalation rules to the
target repository.
