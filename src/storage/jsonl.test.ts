import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";

import type { InboxRecord } from "../schema/inbox-record.ts";

import { appendJsonlRecord, readJsonlFile, writeJsonlFile } from "./jsonl.ts";

function makeRecord(overrides: Partial<InboxRecord> = {}): InboxRecord {
  return {
    body: "Please simplify this branch.",
    botLogin: "coderabbitai",
    commentId: 123_456_789,
    commentUrl: "https://github.com/OWNER/REPO/pull/42#discussion_r123456789",
    createdAt: "2026-03-14T00:00:00.000Z",
    eventType: "pull_request_review_comment",
    headSha: "abc123",
    id: "github-review-comment-123456789",
    pullRequestNumber: 42,
    repository: { name: "REPO", owner: "OWNER" },
    source: "github",
    status: "pending",
    updatedAt: "2026-03-14T00:00:00.000Z",
    ...overrides,
  };
}

function makeTemporaryPath(): string {
  return path.join("/tmp", `yamabiko-test-${randomUUID()}.jsonl`);
}

let temporaryFiles: string[];

beforeEach(() => {
  temporaryFiles = [];
});

afterEach(async () => {
  await Promise.allSettled(temporaryFiles.map((f) => unlink(f)));
});

function trackTemporary(): string {
  const p = makeTemporaryPath();
  temporaryFiles.push(p);
  return p;
}

describe("readJsonlFile", () => {
  it("returns empty array for empty file", async () => {
    const p = trackTemporary();
    await Bun.write(p, "");

    const records = await readJsonlFile(p);

    expect(records).toEqual([]);
  });

  it("parses file with 3 valid records", async () => {
    const r1 = makeRecord({ commentId: 1, id: "rec-1" });
    const r2 = makeRecord({ commentId: 2, id: "rec-2" });
    const r3 = makeRecord({ commentId: 3, id: "rec-3" });
    const p = trackTemporary();
    await Bun.write(p, [r1, r2, r3].map((r) => JSON.stringify(r)).join("\n"));

    const records = await readJsonlFile(p);

    expect(records).toHaveLength(3);
    expect(records[0]?.id).toBe("rec-1");
    expect(records[1]?.id).toBe("rec-2");
    expect(records[2]?.id).toBe("rec-3");
  });

  it("skips invalid lines and parses the rest", async () => {
    const valid = makeRecord({ id: "valid-1" });
    const p = trackTemporary();
    await Bun.write(
      p,
      `${JSON.stringify(valid)}\n{not valid json}\n${JSON.stringify(makeRecord({ commentId: 2, id: "valid-2" }))}`,
    );

    const records = await readJsonlFile(p);

    expect(records).toHaveLength(2);
    expect(records[0]?.id).toBe("valid-1");
    expect(records[1]?.id).toBe("valid-2");
  });

  it("returns empty array for non-existent file without throwing", async () => {
    const p = path.join("/tmp", `nonexistent-${randomUUID()}.jsonl`);

    const records = await readJsonlFile(p);

    expect(records).toEqual([]);
  });
});

describe("writeJsonlFile", () => {
  it("round-trips records through write then read", async () => {
    const r1 = makeRecord({ commentId: 1, id: "rt-1" });
    const r2 = makeRecord({ commentId: 2, id: "rt-2", line: 10, path: "src/bar.ts" });
    const p = trackTemporary();

    await writeJsonlFile(p, [r1, r2]);
    const records = await readJsonlFile(p);

    expect(records).toEqual([r1, r2]);
  });

  it("uses compact JSON with no extra whitespace", async () => {
    const record = makeRecord();
    const p = trackTemporary();

    await writeJsonlFile(p, [record]);

    const raw = await Bun.file(p).text();
    const lines = raw.split("\n").filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/^\s/);
    expect(lines[0]).toBe(JSON.stringify(record));
  });
});

describe("appendJsonlRecord", () => {
  it("creates file if it does not exist", async () => {
    const p = trackTemporary();
    const record = makeRecord({ id: "append-new" });

    await appendJsonlRecord(p, record);

    const records = await readJsonlFile(p);
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe("append-new");
  });

  it("adds record to existing file", async () => {
    const p = trackTemporary();
    const r1 = makeRecord({ commentId: 1, id: "existing-1" });
    await writeJsonlFile(p, [r1]);

    const r2 = makeRecord({ commentId: 2, id: "appended-2" });
    await appendJsonlRecord(p, r2);

    const records = await readJsonlFile(p);
    expect(records).toHaveLength(2);
    expect(records[0]?.id).toBe("existing-1");
    expect(records[1]?.id).toBe("appended-2");
  });
});
