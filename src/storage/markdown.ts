import type { InboxRecord } from "../schema/inbox-record.ts";
import type { InboxStatus } from "../schema/state.ts";

const STATUS_ORDER: ReadonlyMap<InboxStatus, number> = new Map([
  ["claimed", 1],
  ["fixed", 2],
  ["pending", 0],
  ["skipped", 3],
  ["stale", 4],
]);

const MAX_SUMMARY_LENGTH = 80;

export function generateMarkdownSummary(
  records: readonly InboxRecord[],
  prNumber: number,
  repo: { name: string; owner: string },
): string {
  const sorted = sortRecords(records);
  const lines = [
    `# Inbox Summary: ${repo.owner}/${repo.name} PR #${String(prNumber)}`,
    "",
    formatCounts(records),
  ];

  if (records.length > 0) {
    lines.push(
      "",
      "| Status | ID | Bot | File:Line | Summary | Link |",
      "| --- | --- | --- | --- | --- | --- |",
      ...sorted.map((record) => formatRow(record)),
    );
  }

  lines.push("");
  return lines.join("\n");
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", String.raw`\|`).replaceAll(/\r?\n/g, " ");
}

function formatCounts(records: readonly InboxRecord[]): string {
  const counts: Record<InboxStatus, number> = {
    claimed: 0,
    fixed: 0,
    pending: 0,
    skipped: 0,
    stale: 0,
  };

  for (const r of records) {
    counts[r.status]++;
  }

  return (
    `**${String(counts.pending)}** pending, ` +
    `**${String(counts.claimed)}** claimed, ` +
    `**${String(counts.fixed)}** fixed, ` +
    `**${String(counts.skipped)}** skipped, ` +
    `**${String(counts.stale)}** stale`
  );
}

function formatFileLine(record: InboxRecord): string {
  if (record.path && record.line !== undefined) {
    return `${record.path}:${String(record.line)}`;
  }
  if (record.path) {
    return record.path;
  }
  return "";
}

function formatRow(record: InboxRecord): string {
  const fileLine = formatFileLine(record);
  const summary = escapeTableCell(truncateBody(record.body));
  const link = `[comment](${record.commentUrl})`;

  return `| ${record.status} | ${record.id} | ${record.botLogin} | ${fileLine} | ${summary} | ${link} |`;
}

function sortRecords(records: readonly InboxRecord[]): InboxRecord[] {
  const copy: InboxRecord[] = [...records];
  copy.sort((a, b) => {
    const orderA = STATUS_ORDER.get(a.status) ?? 999;
    const orderB = STATUS_ORDER.get(b.status) ?? 999;
    return orderA - orderB;
  });
  return copy;
}

function truncateBody(body: string): string {
  if (body.length <= MAX_SUMMARY_LENGTH) {
    return body;
  }
  return body.slice(0, MAX_SUMMARY_LENGTH) + "...";
}
