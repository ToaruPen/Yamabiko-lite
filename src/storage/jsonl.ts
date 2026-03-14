import { appendFile, rename } from "node:fs/promises";
import path from "node:path";

import type { InboxRecord } from "../schema/inbox-record.ts";

import { parseInboxRecords } from "../schema/inbox-record.ts";

export async function appendJsonlRecord(filePath: string, record: InboxRecord): Promise<void> {
  const line = JSON.stringify(record) + "\n";
  await appendFile(filePath, line);
}

export async function readJsonlFile(filePath: string): Promise<InboxRecord[]> {
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return [];
  }

  const content = await file.text();
  return parseInboxRecords(content);
}

export async function writeJsonlFile(
  filePath: string,
  records: readonly InboxRecord[],
): Promise<void> {
  const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const suffix = `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  const temporaryPath = path.join(path.dirname(filePath), `.tmp-${suffix}`);

  await Bun.write(temporaryPath, content);
  await rename(temporaryPath, filePath);
}
