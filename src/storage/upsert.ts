import type { InboxRecord } from "../schema/inbox-record.ts";

export function upsertRecord(
  existing: readonly InboxRecord[],
  incoming: InboxRecord,
): InboxRecord[] {
  const current = existing.find((r) => r.id === incoming.id);

  if (!current) {
    return [...existing, incoming];
  }

  const merged: InboxRecord = {
    ...current,
    body: incoming.body,
    headSha: incoming.headSha,
    updatedAt: incoming.updatedAt,
  };

  return existing.map((r) => (r.id === incoming.id ? merged : r));
}

export function upsertRecords(
  existing: readonly InboxRecord[],
  incoming: readonly InboxRecord[],
): InboxRecord[] {
  const recordMap = new Map<string, InboxRecord>();

  for (const record of existing) {
    recordMap.set(record.id, record);
  }

  for (const record of incoming) {
    const current = recordMap.get(record.id);
    if (current) {
      recordMap.set(record.id, {
        ...current,
        body: record.body,
        headSha: record.headSha,
        updatedAt: record.updatedAt,
      });
    } else {
      recordMap.set(record.id, record);
    }
  }

  return [...recordMap.values()];
}
