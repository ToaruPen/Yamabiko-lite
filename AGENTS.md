# AGENTS.md

## WHY
- Yamabiko-lite exists to keep AI review remediation inside the original
  implementation context instead of re-running full autonomous repair in a fresh
  worker.

## WHAT
- `README.md`: product intent and scope.
- `docs/implementation-plan.md`: concrete implementation details and rollout
  plan.

## HARD RULES
- Keep v1 file-based and local-first. Do not add a server, queue, or database
  unless the docs are explicitly updated first.
- Prefer a dedicated inbox branch over writing to the default branch.
- Treat autonomous background code mutation as out of scope for v1.
- Keep formats simple: Markdown for summaries and JSONL for machine-readable
  inbox records.
- GitHub Actions must stay non-mutating with respect to PR branches.
- The authoring agent may fix, test, commit, and push after `/check-inbox` or
  equivalent user intent.
- Escalate to the human for specification disputes, security-sensitive changes,
  dependency additions, or merge decisions.

## HOW
- Optimize for the smallest useful workflow that developers can run every day.
- Preserve explicit bot allowlists, stable IDs, and head-SHA checks.
- When implementation starts, update the docs before expanding scope.
