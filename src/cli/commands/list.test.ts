import { afterEach, describe, expect, it, spyOn } from "bun:test";

import type { InboxRecord } from "../../schema/inbox-record.ts";

import { listInboxItems, readInboxFromBranch } from "./list.ts";

function buildJsonl(records: InboxRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

function createMockSubprocess(standardOutput: string, exitCode: number) {
  return {
    exited: Promise.resolve(exitCode),
    stdout: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(standardOutput));
        controller.close();
      },
    }),
  };
}

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

describe("readInboxFromBranch", () => {
  it("reads and parses records from the inbox branch", async () => {
    const records = [
      makeRecord({ commentId: 1, id: "rec-1" }),
      makeRecord({ commentId: 2, id: "rec-2" }),
    ];
    const spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess(buildJsonl(records), 0) as any,
    );

    const result = await readInboxFromBranch("yamabiko-lite-inbox", "OWNER/REPO", 42);

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("rec-1");
    expect(result[1]?.id).toBe("rec-2");

    const callArguments = spawnMock.mock.calls[0]![0] as string[];
    expect(callArguments).toContain("show");
    expect(
      callArguments.some((a) => a.includes(".yamabiko-lite/inbox/OWNER/REPO/pr-42.jsonl")),
    ).toBe(true);

    spawnMock.mockRestore();
  });

  it("returns empty array when JSONL file does not exist", async () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess("", 128) as any,
    );

    const result = await readInboxFromBranch("yamabiko-lite-inbox", "OWNER/REPO", 42);

    expect(result).toEqual([]);

    spawnMock.mockRestore();
  });
});

describe("listInboxItems", () => {
  let logMock: ReturnType<typeof spyOn>;
  let spawnMock: ReturnType<typeof spyOn>;

  afterEach(() => {
    logMock?.mockRestore();
    spawnMock?.mockRestore();
  });

  it("shows 2 pending from 3 records (2 pending, 1 fixed)", async () => {
    const headSha = "current-head-sha";
    const records = [
      makeRecord({ commentId: 1, headSha, id: "rec-1", status: "pending" }),
      makeRecord({ commentId: 2, headSha, id: "rec-2", status: "pending" }),
      makeRecord({ commentId: 3, headSha, id: "rec-3", status: "fixed" }),
    ];

    spawnMock = spyOn(Bun, "spawn").mockImplementation((arguments_: any) => {
      if (arguments_.includes("rev-parse")) {
        return createMockSubprocess(headSha + "\n", 0) as any;
      }
      return createMockSubprocess(buildJsonl(records), 0) as any;
    });
    logMock = spyOn(console, "log").mockImplementation(() => void 0);

    await listInboxItems({
      branch: "yamabiko-lite-inbox",
      includeStale: false,
      json: false,
      pr: 42,
      repo: "OWNER/REPO",
    });

    const output = logMock.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("2");
    expect(output).toContain("pending");
    expect(output).toContain("rec-1");
    expect(output).toContain("rec-2");
    expect(output).toContain("rec-3");
  });

  it("outputs valid parseable JSON array with --json", async () => {
    const headSha = "current-head-sha";
    const records = [
      makeRecord({ commentId: 1, headSha, id: "json-1" }),
      makeRecord({ commentId: 2, headSha, id: "json-2" }),
    ];

    spawnMock = spyOn(Bun, "spawn").mockImplementation((arguments_: any) => {
      if (arguments_.includes("rev-parse")) {
        return createMockSubprocess(headSha + "\n", 0) as any;
      }
      return createMockSubprocess(buildJsonl(records), 0) as any;
    });
    logMock = spyOn(console, "log").mockImplementation(() => void 0);

    await listInboxItems({
      branch: "yamabiko-lite-inbox",
      includeStale: false,
      json: true,
      pr: 42,
      repo: "OWNER/REPO",
    });

    const output = logMock.mock.calls[0]![0] as string;
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe("json-1");
  });

  it("excludes stale records by default", async () => {
    const currentSha = "current-sha";
    const records = [
      makeRecord({ commentId: 1, headSha: currentSha, id: "fresh-1", status: "pending" }),
      makeRecord({ commentId: 2, headSha: currentSha, id: "stale-status", status: "stale" }),
      makeRecord({ commentId: 3, headSha: "old-sha", id: "stale-sha", status: "pending" }),
    ];

    spawnMock = spyOn(Bun, "spawn").mockImplementation((arguments_: any) => {
      if (arguments_.includes("rev-parse")) {
        return createMockSubprocess(currentSha + "\n", 0) as any;
      }
      return createMockSubprocess(buildJsonl(records), 0) as any;
    });
    logMock = spyOn(console, "log").mockImplementation(() => void 0);

    await listInboxItems({
      branch: "yamabiko-lite-inbox",
      includeStale: false,
      json: true,
      pr: 42,
      repo: "OWNER/REPO",
    });

    const output = logMock.mock.calls[0]![0] as string;
    const parsed = JSON.parse(output) as InboxRecord[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.id).toBe("fresh-1");
  });

  it("includes stale records when --include-stale is set", async () => {
    const currentSha = "current-sha";
    const records = [
      makeRecord({ commentId: 1, headSha: currentSha, id: "fresh-1", status: "pending" }),
      makeRecord({ commentId: 2, headSha: currentSha, id: "stale-status", status: "stale" }),
      makeRecord({ commentId: 3, headSha: "old-sha", id: "stale-sha", status: "pending" }),
    ];

    spawnMock = spyOn(Bun, "spawn").mockImplementation((arguments_: any) => {
      if (arguments_.includes("rev-parse")) {
        return createMockSubprocess(currentSha + "\n", 0) as any;
      }
      return createMockSubprocess(buildJsonl(records), 0) as any;
    });
    logMock = spyOn(console, "log").mockImplementation(() => void 0);

    await listInboxItems({
      branch: "yamabiko-lite-inbox",
      includeStale: true,
      json: true,
      pr: 42,
      repo: "OWNER/REPO",
    });

    const output = logMock.mock.calls[0]![0] as string;
    const parsed = JSON.parse(output) as InboxRecord[];
    expect(parsed).toHaveLength(3);
  });

  it("shows 'No pending inbox items' when no records match", async () => {
    spawnMock = spyOn(Bun, "spawn").mockImplementation((arguments_: any) => {
      if (arguments_.includes("rev-parse")) {
        return createMockSubprocess("current-sha\n", 0) as any;
      }
      return createMockSubprocess("", 128) as any;
    });
    logMock = spyOn(console, "log").mockImplementation(() => void 0);

    await listInboxItems({
      branch: "yamabiko-lite-inbox",
      includeStale: false,
      json: false,
      pr: 42,
      repo: "OWNER/REPO",
    });

    const output = logMock.mock.calls[0]![0] as string;
    expect(output).toContain("No pending inbox items for PR #42");
  });
});
