import { beforeEach, describe, expect, mock, test } from "bun:test";

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
  readJsonlFile: () => {
    throw new Error("readJsonlFile should not be called in resolve");
  },
  writeJsonlFile: (...arguments_: Parameters<typeof mockWriteJsonlFile>) =>
    mockWriteJsonlFile(...arguments_),
}));

mock.module("../inbox-lock.ts", () => ({
  withInboxMutationLock: (...arguments_: Parameters<typeof mockWithInboxMutationLock>) =>
    mockWithInboxMutationLock(...arguments_),
}));

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

    expect(result).toBe("Resolved: github-pull_request_review_comment-100 (claimed → fixed)");

    const writtenRecords = mockWriteJsonlFile.mock.calls[0]?.[1] as InboxRecord[];
    expect(writtenRecords).toHaveLength(1);
    expect(writtenRecords[0]!.status).toBe("fixed");
    expect(writtenRecords[0]!.updatedAt).not.toBe(record.updatedAt);
    expect(writtenRecords[0]!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test("normalizes mixed-case repo input before locking and writing", async () => {
    const record = makeRecord({ id: "github-pull_request_review_comment-100", status: "claimed" });
    mockReadFileFromBranch.mockResolvedValue(JSON.stringify(record));

    await runResolve({
      branch: "yamabiko-lite-inbox",
      id: "github-pull_request_review_comment-100",
      pr: "1",
      repo: "Owner/Repo",
      status: "fixed",
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

  test("reuses a legacy mixed-case inbox path when one already exists", async () => {
    const record = makeRecord({ id: "github-pull_request_review_comment-100", status: "claimed" });
    mockResolveInboxPathsInBranch.mockResolvedValue({
      jsonlPath: ".yamabiko-lite/inbox/Owner/Repo/pr-1.jsonl",
      mdPath: ".yamabiko-lite/inbox/Owner/Repo/pr-1.md",
    });
    mockReadFileFromBranch.mockResolvedValue(JSON.stringify(record));

    await runResolve({
      branch: "yamabiko-lite-inbox",
      id: "github-pull_request_review_comment-100",
      pr: "1",
      repo: "owner/repo",
      status: "fixed",
    });

    expect(mockWriteJsonlFile.mock.calls[0]?.[0]).toBe(
      "/tmp/yamabiko-inbox-test/.yamabiko-lite/inbox/Owner/Repo/pr-1.jsonl",
    );
  });

  test("surfaces lock contention before mutating the inbox", async () => {
    mockWithInboxMutationLock.mockRejectedValue(
      new Error(
        "Inbox mutation lock already held for owner/repo PR #1 on branch yamabiko-lite-inbox.",
      ),
    );

    await expect(
      runResolve({
        branch: "yamabiko-lite-inbox",
        id: "github-pull_request_review_comment-100",
        pr: "1",
        repo: "owner/repo",
        status: "fixed",
      }),
    ).rejects.toThrow(
      "Inbox mutation lock already held for owner/repo PR #1 on branch yamabiko-lite-inbox.",
    );

    expect(mockEnsureInboxBranch).not.toHaveBeenCalled();
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

    expect(result).toBe("Resolved: github-pull_request_review_comment-200 (claimed → skipped)");

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

  test("rejects non-positive or non-integer PR numbers", async () => {
    await expect(
      runResolve({
        branch: "yamabiko-lite-inbox",
        id: "github-pull_request_review_comment-400",
        pr: "0",
        repo: "owner/repo",
        status: "fixed",
      }),
    ).rejects.toThrow(`Invalid PR number: "0". Expected a positive integer.`);

    await expect(
      runResolve({
        branch: "yamabiko-lite-inbox",
        id: "github-pull_request_review_comment-400",
        pr: "1.5",
        repo: "owner/repo",
        status: "fixed",
      }),
    ).rejects.toThrow(`Invalid PR number: "1.5". Expected a positive integer.`);
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
    // eslint-disable-next-line unicorn/no-null -- readFileFromBranch returns null for missing files
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
