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

export function validateJsonlIntegrity(content: null | string, parsedCount: number): void {
  if (content === null) return;
  const rawLineCount = content
    .trim()
    .split("\n")
    .filter((line) => line.trim() !== "").length;
  if (parsedCount < rawLineCount) {
    throw new Error(
      `JSONL integrity check failed: parsed ${String(parsedCount)} records but found ${String(rawLineCount)} non-empty lines. Aborting to prevent data loss.`,
    );
  }
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
