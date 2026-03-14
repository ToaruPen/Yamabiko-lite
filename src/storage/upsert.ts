import type { InboxRecord } from "../schema/inbox-record.js";

export function upsertRecord(
  existing: readonly InboxRecord[],
  incoming: InboxRecord,
): InboxRecord[] {
  const index = existing.findIndex((r) => r.id === incoming.id);

  if (index === -1) {
    return [...existing, incoming];
  }

  const current = existing[index];
  if (!current) {
    return [...existing, incoming];
  }

  const merged: InboxRecord = {
    ...current,
    body: incoming.body,
    headSha: incoming.headSha,
    updatedAt: incoming.updatedAt,
  };

  const result = [...existing];
  result[index] = merged;
  return result;
}

export function upsertRecords(
  existing: readonly InboxRecord[],
  incoming: readonly InboxRecord[],
): InboxRecord[] {
  let result: InboxRecord[] = [...existing];

  for (const record of incoming) {
    result = upsertRecord(result, record);
  }

  return result;
}
