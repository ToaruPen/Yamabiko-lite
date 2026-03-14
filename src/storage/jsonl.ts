import type { InboxRecord } from "../schema/inbox-record.ts";

export async function readJsonlFile(_filePath: string): Promise<InboxRecord[]> {
  throw new Error("Not implemented");
}

export async function writeJsonlFile(
  _filePath: string,
  _records: readonly InboxRecord[],
): Promise<void> {
  throw new Error("Not implemented");
}

export async function appendJsonlRecord(_filePath: string, _record: InboxRecord): Promise<void> {
  throw new Error("Not implemented");
}
