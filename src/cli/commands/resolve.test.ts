import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import type { InboxRecord } from "../../schema/inbox-record.ts";

import { runResolve } from "./resolve.ts";

function makeRecord(overrides: Partial<InboxRecord> = {}): InboxRecord {
  return {
    body: "Please fix the variable name",
    botLogin: "copilot-review[bot]",
    commentId: 100,
    commentUrl: "https://github.com/owner/repo/pull/1#discussion_r100",
    createdAt: "2026-03-01T00:00:00Z",
    eventType: "pull_request_review_comment",
    headSha: "abc123",
    id: "github-pull_request_review_comment-100",
    pullRequestNumber: 1,
    repository: { name: "repo", owner: "owner" },
    source: "github",
    status: "pending",
    updatedAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

const mockReadFileFromBranch = mock<
  (branchName: string, filePath: string) => Promise<null | string>
>();
const mockEnsureInboxBranch = mock<(branchName: string) => Promise<string>>();
const mockCommitAndPushInbox = mock<
  (worktreePath: string, branchName: string, message: string) => Promise<boolean>
>();
const mockCleanupWorktree = mock<(worktreePath: string) => Promise<void>>();
const mockWriteJsonlFile = mock<
  (filePath: string, records: readonly InboxRecord[]) => Promise<void>
>();

mock.module("../../actions/branch.ts", () => ({
  cleanupWorktree: (...args: Parameters<typeof mockCleanupWorktree>) =>
    mockCleanupWorktree(...args),
  commitAndPushInbox: (...args: Parameters<typeof mockCommitAndPushInbox>) =>
    mockCommitAndPushInbox(...args),
  ensureInboxBranch: (...args: Parameters<typeof mockEnsureInboxBranch>) =>
    mockEnsureInboxBranch(...args),
  readFileFromBranch: (...args: Parameters<typeof mockReadFileFromBranch>) =>
    mockReadFileFromBranch(...args),
}));

mock.module("../../storage/jsonl.ts", () => ({
  readJsonlFile: () => {
    throw new Error("readJsonlFile should not be called in resolve");
  },
  writeJsonlFile: (...args: Parameters<typeof mockWriteJsonlFile>) =>
    mockWriteJsonlFile(...args),
}));

const writtenFiles = new Map<string, string>();
mock.module("../../storage/markdown.ts", () => {
  const original = require("../../storage/markdown.ts");
  return {
    generateMarkdownSummary: original.generateMarkdownSummary,
  };
});

beforeEach(() => {
  mockReadFileFromBranch.mockReset();
  mockEnsureInboxBranch.mockReset();
  mockCommitAndPushInbox.mockReset();
  mockCleanupWorktree.mockReset();
  mockWriteJsonlFile.mockReset();
  writtenFiles.clear();

  mockEnsureInboxBranch.mockResolvedValue("/tmp/yamabiko-inbox-test");
  mockCommitAndPushInbox.mockResolvedValue(true);
  mockCleanupWorktree.mockResolvedValue(undefined);
  mockWriteJsonlFile.mockResolvedValue(undefined);
});

afterEach(() => {
  mockReadFileFromBranch.mockReset();
  mockEnsureInboxBranch.mockReset();
  mockCommitAndPushInbox.mockReset();
  mockCleanupWorktree.mockReset();
  mockWriteJsonlFile.mockReset();
});

describe("inbox resolve", () => {
  test("resolves claimed → fixed", async () => {
    const record = makeRecord({
      id: "github-pull_request_review_comment-100",
      status: "claimed",
    });
    const jsonlContent = JSON.stringify(record);
    mockReadFileFromBranch.mockResolvedValue(jsonlContent);

    const result = await runResolve({
      branch: "yamabiko-lite-inbox",
      id: "github-pull_request_review_comment-100",
      pr: "1",
      repo: "owner/repo",
      status: "fixed",
    });

    expect(result).toBe(
      "Resolved: github-pull_request_review_comment-100 (claimed → fixed)",
    );

    const writtenRecords = mockWriteJsonlFile.mock.calls[0]?.[1] as InboxRecord[];
    expect(writtenRecords).toHaveLength(1);
    expect(writtenRecords[0]!.status).toBe("fixed");
    expect(writtenRecords[0]!.updatedAt).not.toBe(record.updatedAt);
  });

  test("resolves claimed → skipped", async () => {
    const record = makeRecord({
      id: "github-pull_request_review_comment-200",
      status: "claimed",
    });
    const jsonlContent = JSON.stringify(record);
    mockReadFileFromBranch.mockResolvedValue(jsonlContent);

    const result = await runResolve({
      branch: "yamabiko-lite-inbox",
      id: "github-pull_request_review_comment-200",
      pr: "1",
      repo: "owner/repo",
      status: "skipped",
    });

    expect(result).toBe(
      "Resolved: github-pull_request_review_comment-200 (claimed → skipped)",
    );

    const writtenRecords = mockWriteJsonlFile.mock.calls[0]?.[1] as InboxRecord[];
    expect(writtenRecords).toHaveLength(1);
    expect(writtenRecords[0]!.status).toBe("skipped");
  });

  test("rejects resolve from pending (not claimed) → error", async () => {
    const record = makeRecord({
      id: "github-pull_request_review_comment-300",
      status: "pending",
    });
    const jsonlContent = JSON.stringify(record);
    mockReadFileFromBranch.mockResolvedValue(jsonlContent);

    await expect(
      runResolve({
        branch: "yamabiko-lite-inbox",
        id: "github-pull_request_review_comment-300",
        pr: "1",
        repo: "owner/repo",
        status: "fixed",
      }),
    ).rejects.toThrow("Invalid state transition");
  });

  test("rejects invalid status value", async () => {
    await expect(
      runResolve({
        branch: "yamabiko-lite-inbox",
        id: "github-pull_request_review_comment-400",
        pr: "1",
        repo: "owner/repo",
        status: "stale",
      }),
    ).rejects.toThrow('Invalid resolve status: "stale". Must be "fixed" or "skipped".');
  });

  test("errors when ID is not found", async () => {
    const record = makeRecord({
      id: "github-pull_request_review_comment-999",
      status: "claimed",
    });
    const jsonlContent = JSON.stringify(record);
    mockReadFileFromBranch.mockResolvedValue(jsonlContent);

    await expect(
      runResolve({
        branch: "yamabiko-lite-inbox",
        id: "github-pull_request_review_comment-404",
        pr: "1",
        repo: "owner/repo",
        status: "fixed",
      }),
    ).rejects.toThrow("Item not found: github-pull_request_review_comment-404");
  });

  test("cleans up worktree even on error", async () => {
    mockReadFileFromBranch.mockResolvedValue(null);

    await expect(
      runResolve({
        branch: "yamabiko-lite-inbox",
        id: "nonexistent",
        pr: "1",
        repo: "owner/repo",
        status: "fixed",
      }),
    ).rejects.toThrow("Item not found");

    expect(mockCleanupWorktree).toHaveBeenCalledWith("/tmp/yamabiko-inbox-test");
  });
});
