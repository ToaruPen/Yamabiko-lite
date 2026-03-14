import type { InboxRecord } from "../schema/inbox-record.ts";

/**
 * Generates a human-readable Markdown summary from inbox records.
 * Pure function — no I/O, no side effects.
 */
export function generateMarkdownSummary(
  _records: readonly InboxRecord[],
  _prNumber: number,
  _repo: { owner: string; name: string },
): string {
  throw new Error("Not implemented");
}
