import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

import type { InboxRecord } from "../../schema/inbox-record.ts";

const mockReadFileFromBranch =
  mock<(branchName: string, filePath: string) => Promise<null | string>>();
const mockEnsureInboxBranch = mock<(branchName: string) => Promise<string>>();
const mockCommitAndPushInbox =
  mock<(worktreePath: string, branchName: string, message: string) => Promise<boolean>>();
const mockCleanupWorktree = mock<(worktreePath: string) => Promise<void>>();
const mockWriteJsonlFile =
  mock<(filePath: string, records: readonly InboxRecord[]) => Promise<void>>();
const mockResolveInboxPathsInBranch = mock(
  (_branch: string, owner: string, repo: string, prNumber: number) =>
    Promise.resolve({
      jsonlPath: `.yamabiko-lite/inbox/${owner}/${repo}/pr-${String(prNumber)}.jsonl`,
      mdPath: `.yamabiko-lite/inbox/${owner}/${repo}/pr-${String(prNumber)}.md`,
    }),
);
const mockWithInboxMutationLock = mock(<T>(_: unknown, operation: () => Promise<T>) => operation());

mock.module("../../actions/branch.ts", () => ({
  cleanupWorktree: (...arguments_: Parameters<typeof mockCleanupWorktree>) =>
    mockCleanupWorktree(...arguments_),
  commitAndPushInbox: (...arguments_: Parameters<typeof mockCommitAndPushInbox>) =>
    mockCommitAndPushInbox(...arguments_),
  ensureInboxBranch: (...arguments_: Parameters<typeof mockEnsureInboxBranch>) =>
    mockEnsureInboxBranch(...arguments_),
  readFileFromBranch: (...arguments_: Parameters<typeof mockReadFileFromBranch>) =>
    mockReadFileFromBranch(...arguments_),
  resolveInboxPathsInBranch: (...arguments_: Parameters<typeof mockResolveInboxPathsInBranch>) =>
    mockResolveInboxPathsInBranch(...arguments_),
}));

mock.module("../../storage/jsonl.ts", () => ({
  writeJsonlFile: (...arguments_: Parameters<typeof mockWriteJsonlFile>) =>
    mockWriteJsonlFile(...arguments_),
}));

mock.module("../inbox-lock.ts", () => ({
  withInboxMutationLock: (...arguments_: Parameters<typeof mockWithInboxMutationLock>) =>
    mockWithInboxMutationLock(...arguments_),
}));

import { applyClaimToRecords, runClaim } from "./claim.ts";

function makeRecord(overrides: Partial<InboxRecord> = {}): InboxRecord {
  return {
    body: "Fix this variable name",
    botLogin: "copilot-review[bot]",
    commentId: 100,
    commentUrl: "https://github.com/owner/repo/pull/1#discussion_r100",
    createdAt: "2026-03-01T00:00:00Z",
    eventType: "pull_request_review_comment",
    headSha: "abc123",
    id: "rec-001",
    pullRequestNumber: 1,
    repository: { name: "repo", owner: "owner" },
    source: "github",
    status: "pending",
    updatedAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

let bunWriteMock: ReturnType<typeof spyOn>;
let logMock: ReturnType<typeof spyOn>;

beforeEach(() => {
  mockReadFileFromBranch.mockReset();
  mockEnsureInboxBranch.mockReset();
  mockCommitAndPushInbox.mockReset();
  mockCleanupWorktree.mockReset();
  mockWriteJsonlFile.mockReset();
  mockResolveInboxPathsInBranch.mockReset();
  mockWithInboxMutationLock.mockReset();

  mockEnsureInboxBranch.mockResolvedValue("/tmp/yamabiko-inbox-test");
  mockCommitAndPushInbox.mockResolvedValue(true);
  mockCleanupWorktree.mockResolvedValue();
  mockWriteJsonlFile.mockResolvedValue();
  mockResolveInboxPathsInBranch.mockImplementation(
    (_branch: string, owner: string, repo: string, prNumber: number) =>
      Promise.resolve({
        jsonlPath: `.yamabiko-lite/inbox/${owner}/${repo}/pr-${String(prNumber)}.jsonl`,
        mdPath: `.yamabiko-lite/inbox/${owner}/${repo}/pr-${String(prNumber)}.md`,
      }),
  );
  mockWithInboxMutationLock.mockImplementation(<T>(_: unknown, operation: () => Promise<T>) =>
    operation(),
  );

  bunWriteMock = spyOn(Bun, "write").mockResolvedValue(0);
  logMock = spyOn(console, "log").mockImplementation(() => void 0);
});

afterEach(() => {
  mockReadFileFromBranch.mockReset();
  mockEnsureInboxBranch.mockReset();
  mockCommitAndPushInbox.mockReset();
  mockCleanupWorktree.mockReset();
  mockWriteJsonlFile.mockReset();
  mockResolveInboxPathsInBranch.mockReset();
  mockWithInboxMutationLock.mockReset();
  bunWriteMock.mockRestore();
  logMock.mockRestore();
});

describe("applyClaimToRecords", () => {
  it("claims a pending item and updates status to claimed", () => {
    const records = [makeRecord({ id: "rec-001", status: "pending" })];

    const result = applyClaimToRecords(records, "rec-001");

    expect(result.updatedRecords[0]!.status).toBe("claimed");
    expect(result.updatedRecords[0]!.updatedAt).not.toBe("2026-03-01T00:00:00Z");
    expect(result.previousStatus).toBe("pending");
    expect(result.message).toContain("Claimed: rec-001");
    expect(result.message).toContain("pending → claimed");
  });

  it("throws when claiming an already-claimed item", () => {
    const records = [makeRecord({ id: "rec-001", status: "claimed" })];

    expect(() => applyClaimToRecords(records, "rec-001")).toThrow("claimed");
  });

  it("throws when claiming a fixed item", () => {
    const records = [makeRecord({ id: "rec-001", status: "fixed" })];

    expect(() => applyClaimToRecords(records, "rec-001")).toThrow("fixed");
  });

  it("throws Item not found for non-existent ID", () => {
    const records = [makeRecord({ id: "rec-001", status: "pending" })];

    expect(() => applyClaimToRecords(records, "nonexistent")).toThrow(
      "Item not found: nonexistent",
    );
  });
});

describe("runClaim", () => {
  it("claims an inbox item through the git-backed workflow", async () => {
    const record = makeRecord({ id: "rec-123", status: "pending" });
    mockReadFileFromBranch.mockResolvedValue(JSON.stringify(record));

    const result = await runClaim({
      branch: "yamabiko-lite-inbox",
      id: "rec-123",
      pr: "1",
      repo: "owner/repo",
    });

    expect(result).toBe("Claimed: rec-123 (pending → claimed)");
    expect(mockWriteJsonlFile).toHaveBeenCalledTimes(1);
    expect(mockWriteJsonlFile.mock.calls[0]?.[0]).toBe(
      "/tmp/yamabiko-inbox-test/.yamabiko-lite/inbox/owner/repo/pr-1.jsonl",
    );
    const writtenRecords = mockWriteJsonlFile.mock.calls[0]?.[1] as InboxRecord[];
    expect(writtenRecords).toHaveLength(1);
    expect(writtenRecords[0]!.status).toBe("claimed");
    expect(bunWriteMock).toHaveBeenCalledWith(
      "/tmp/yamabiko-inbox-test/.yamabiko-lite/inbox/owner/repo/pr-1.md",
      expect.any(String),
    );
    expect(mockCommitAndPushInbox).toHaveBeenCalledWith(
      "/tmp/yamabiko-inbox-test",
      "yamabiko-lite-inbox",
      "claim: rec-123",
    );
    expect(mockCleanupWorktree).toHaveBeenCalledWith("/tmp/yamabiko-inbox-test");
  });

  it("reuses a legacy mixed-case inbox path when one already exists", async () => {
    const record = makeRecord({ id: "rec-123", status: "pending" });
    mockResolveInboxPathsInBranch.mockResolvedValue({
      jsonlPath: ".yamabiko-lite/inbox/Owner/Repo/pr-1.jsonl",
      mdPath: ".yamabiko-lite/inbox/Owner/Repo/pr-1.md",
    });
    mockReadFileFromBranch.mockResolvedValue(JSON.stringify(record));

    await runClaim({
      branch: "yamabiko-lite-inbox",
      id: "rec-123",
      pr: "1",
      repo: "owner/repo",
    });

    expect(mockWriteJsonlFile.mock.calls[0]?.[0]).toBe(
      "/tmp/yamabiko-inbox-test/.yamabiko-lite/inbox/Owner/Repo/pr-1.jsonl",
    );
  });

  it("normalizes mixed-case repo input before locking and writing", async () => {
    const record = makeRecord({ id: "rec-123", status: "pending" });
    mockReadFileFromBranch.mockResolvedValue(JSON.stringify(record));

    await runClaim({
      branch: "yamabiko-lite-inbox",
      id: "rec-123",
      pr: "1",
      repo: "Owner/Repo",
    });

    expect(mockWithInboxMutationLock).toHaveBeenCalledWith(
      {
        branch: "yamabiko-lite-inbox",
        owner: "owner",
        prNumber: 1,
        repo: "repo",
      },
      expect.any(Function),
    );
    expect(mockWriteJsonlFile.mock.calls[0]?.[0]).toBe(
      "/tmp/yamabiko-inbox-test/.yamabiko-lite/inbox/owner/repo/pr-1.jsonl",
    );
  });

  it("surfaces lock contention before mutating the inbox", async () => {
    mockWithInboxMutationLock.mockRejectedValue(
      new Error(
        "Inbox mutation lock already held for owner/repo PR #1 on branch yamabiko-lite-inbox.",
      ),
    );

    await expect(
      runClaim({
        branch: "yamabiko-lite-inbox",
        id: "rec-123",
        pr: "1",
        repo: "owner/repo",
      }),
    ).rejects.toThrow(
      "Inbox mutation lock already held for owner/repo PR #1 on branch yamabiko-lite-inbox.",
    );

    expect(mockEnsureInboxBranch).not.toHaveBeenCalled();
  });

  it("cleans up worktree when claim fails", async () => {
    // eslint-disable-next-line unicorn/no-null -- readFileFromBranch returns null for missing files
    mockReadFileFromBranch.mockResolvedValue(null);

    await expect(
      runClaim({
        branch: "yamabiko-lite-inbox",
        id: "missing-id",
        pr: "1",
        repo: "owner/repo",
      }),
    ).rejects.toThrow("Item not found: missing-id");

    expect(mockCleanupWorktree).toHaveBeenCalledWith("/tmp/yamabiko-inbox-test");
  });
});
