import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

import type { InboxRecord } from "../../schema/inbox-record.ts";

function buildJsonl(records: InboxRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

function createMockSubprocess(standardOutput: string, exitCode: number, standardError = "") {
  return {
    exited: Promise.resolve(exitCode),
    stderr: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(standardError));
        controller.close();
      },
    }),
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

// Mock branch module to prevent cross-test contamination from claim.test.ts
// eslint-disable-next-line unicorn/no-null -- readFileFromBranch API contract returns null
const mockReadFileFromBranch = mock(() => Promise.resolve(null as null | string));
const mockResolveInboxPathsInBranch = mock(
  (_branch: string, owner: string, repo: string, prNumber: number) =>
    Promise.resolve({
      jsonlPath: `.yamabiko-lite/inbox/${owner}/${repo}/pr-${String(prNumber)}.jsonl`,
      mdPath: `.yamabiko-lite/inbox/${owner}/${repo}/pr-${String(prNumber)}.md`,
    }),
);

mock.module("../../actions/branch.ts", () => ({
  cleanupWorktree: mock(() => Promise.resolve()),
  commitAndPushInbox: mock(() => Promise.resolve(true)),
  ensureInboxBranch: mock(() => Promise.resolve("/tmp/fake")),
  fetchInboxBranch: mock(() => Promise.resolve()),
  readFileFromBranch: mockReadFileFromBranch,
  resolveInboxPathsInBranch: mockResolveInboxPathsInBranch,
}));

import { listInboxItems, readInboxFromBranch } from "./list.ts";

beforeEach(() => {
  mockResolveInboxPathsInBranch.mockImplementation(
    (_branch: string, owner: string, repo: string, prNumber: number) =>
      Promise.resolve({
        jsonlPath: `.yamabiko-lite/inbox/${owner}/${repo}/pr-${String(prNumber)}.jsonl`,
        mdPath: `.yamabiko-lite/inbox/${owner}/${repo}/pr-${String(prNumber)}.md`,
      }),
  );
});

describe("readInboxFromBranch", () => {
  afterEach(() => {
    mockReadFileFromBranch.mockReset();
    mockResolveInboxPathsInBranch.mockReset();
  });

  it("reads and parses records from the inbox branch", async () => {
    const records = [
      makeRecord({ commentId: 1, id: "rec-1" }),
      makeRecord({ commentId: 2, id: "rec-2" }),
    ];
    mockReadFileFromBranch.mockImplementation(() => Promise.resolve(buildJsonl(records).trim()));

    const result = await readInboxFromBranch("yamabiko-lite-inbox", "OWNER/REPO", 42);

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("rec-1");
    expect(result[1]?.id).toBe("rec-2");

    expect(mockReadFileFromBranch).toHaveBeenCalledWith(
      "yamabiko-lite-inbox",
      ".yamabiko-lite/inbox/owner/repo/pr-42.jsonl",
    );
  });

  it("reuses an existing legacy mixed-case inbox path", async () => {
    const records = [makeRecord({ commentId: 1, id: "rec-1" })];
    mockResolveInboxPathsInBranch.mockResolvedValue({
      jsonlPath: ".yamabiko-lite/inbox/Owner/Repo/pr-42.jsonl",
      mdPath: ".yamabiko-lite/inbox/Owner/Repo/pr-42.md",
    });
    mockReadFileFromBranch.mockImplementation(() => Promise.resolve(buildJsonl(records).trim()));

    await readInboxFromBranch("yamabiko-lite-inbox", "owner/repo", 42);

    expect(mockReadFileFromBranch).toHaveBeenCalledWith(
      "yamabiko-lite-inbox",
      ".yamabiko-lite/inbox/Owner/Repo/pr-42.jsonl",
    );
  });

  it("normalizes mixed-case repo input before building the inbox path", async () => {
    const records = [makeRecord({ commentId: 1, id: "rec-1" })];
    mockReadFileFromBranch.mockImplementation(() => Promise.resolve(buildJsonl(records).trim()));

    await readInboxFromBranch("yamabiko-lite-inbox", "Owner/Repo", 42);

    expect(mockReadFileFromBranch).toHaveBeenCalledWith(
      "yamabiko-lite-inbox",
      ".yamabiko-lite/inbox/owner/repo/pr-42.jsonl",
    );
  });

  it("returns empty array when JSONL file does not exist", async () => {
    // eslint-disable-next-line unicorn/no-null -- matching readFileFromBranch API
    mockReadFileFromBranch.mockImplementation(() => Promise.resolve(null));

    const result = await readInboxFromBranch("yamabiko-lite-inbox", "OWNER/REPO", 42);

    expect(result).toEqual([]);
  });

  it("throws for invalid repo format", async () => {
    await expect(
      readInboxFromBranch("yamabiko-lite-inbox", "OWNER/REPO/EXTRA", 42),
    ).rejects.toThrow('Invalid repo format: "OWNER/REPO/EXTRA". Expected "owner/repo".');
  });
});

describe("listInboxItems", () => {
  let logMock: ReturnType<typeof spyOn>;
  let spawnMock: ReturnType<typeof spyOn>;

  afterEach(() => {
    logMock?.mockRestore();
    spawnMock?.mockRestore();
    mockReadFileFromBranch.mockReset();
  });

  it("shows 2 pending from 3 records (2 pending, 1 fixed)", async () => {
    const headSha = "current-head-sha";
    const records = [
      makeRecord({ commentId: 1, headSha, id: "rec-1", status: "pending" }),
      makeRecord({ commentId: 2, headSha, id: "rec-2", status: "pending" }),
      makeRecord({ commentId: 3, headSha, id: "rec-3", status: "fixed" }),
    ];

    mockReadFileFromBranch.mockImplementation(() => Promise.resolve(buildJsonl(records).trim()));
    spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess(headSha + "\n", 0) as any,
    );
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

    mockReadFileFromBranch.mockImplementation(() => Promise.resolve(buildJsonl(records).trim()));
    spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess(headSha + "\n", 0) as any,
    );
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

    mockReadFileFromBranch.mockImplementation(() => Promise.resolve(buildJsonl(records).trim()));
    spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess(currentSha + "\n", 0) as any,
    );
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

    mockReadFileFromBranch.mockImplementation(() => Promise.resolve(buildJsonl(records).trim()));
    spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess(currentSha + "\n", 0) as any,
    );
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

  it("shows 'No inbox items found' when no records match", async () => {
    // eslint-disable-next-line unicorn/no-null -- matching readFileFromBranch API
    mockReadFileFromBranch.mockImplementation(() => Promise.resolve(null));
    spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess("current-sha\n", 0) as any,
    );
    logMock = spyOn(console, "log").mockImplementation(() => void 0);

    await listInboxItems({
      branch: "yamabiko-lite-inbox",
      includeStale: false,
      json: false,
      pr: 42,
      repo: "OWNER/REPO",
    });

    const output = logMock.mock.calls[0]![0] as string;
    expect(output).toContain("No inbox items found for PR #42");
  });

  it("throws when git rev-parse exits non-zero", async () => {
    const records = [makeRecord({ commentId: 1, id: "rec-1" })];
    mockReadFileFromBranch.mockImplementation(() => Promise.resolve(buildJsonl(records).trim()));
    spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess("", 128, "fatal: not a git repository") as any,
    );

    await expect(
      listInboxItems({
        branch: "yamabiko-lite-inbox",
        includeStale: false,
        json: false,
        pr: 42,
        repo: "OWNER/REPO",
      }),
    ).rejects.toThrow("Failed to get current HEAD SHA: fatal: not a git repository");
  });
});
