import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import path from "node:path";

import type { InboxRecord } from "../schema/inbox-record.ts";

const mockCleanupWorktree = mock<(worktreePath: string) => Promise<void>>();
const mockCommitAndPushInbox =
  mock<(worktreePath: string, branchName: string, message: string) => Promise<boolean>>();
const mockEnsureInboxBranch = mock<(branchName: string) => Promise<string>>();
const mockReadFileFromBranch =
  mock<(branchName: string, filePath: string) => Promise<null | string>>();
const mockFetchPullRequestHeadSha =
  mock<(owner: string, repo: string, prNumber: number, token: string) => Promise<string>>();
const mockReconcilePullRequest =
  mock<
    (options: {
      allowlist: readonly string[];
      existingRecords: readonly InboxRecord[];
      headSha: string;
      owner: string;
      prNumber: number;
      repo: string;
      token: string;
    }) => Promise<{ added: number; records: InboxRecord[]; unchanged: number; updated: number }>
  >();
const mockWriteJsonlFile =
  mock<(filePath: string, records: readonly InboxRecord[]) => Promise<void>>();
const mockGenerateMarkdownSummary =
  mock<
    (
      records: readonly InboxRecord[],
      prNumber: number,
      repo: { name: string; owner: string },
    ) => string
  >();

mock.module("./branch.ts", () => ({
  cleanupWorktree: (...arguments_: Parameters<typeof mockCleanupWorktree>) =>
    mockCleanupWorktree(...arguments_),
  commitAndPushInbox: (...arguments_: Parameters<typeof mockCommitAndPushInbox>) =>
    mockCommitAndPushInbox(...arguments_),
  ensureInboxBranch: (...arguments_: Parameters<typeof mockEnsureInboxBranch>) =>
    mockEnsureInboxBranch(...arguments_),
  readFileFromBranch: (...arguments_: Parameters<typeof mockReadFileFromBranch>) =>
    mockReadFileFromBranch(...arguments_),
}));

mock.module("../api/github.ts", () => ({
  fetchPullRequestHeadSha: (...arguments_: Parameters<typeof mockFetchPullRequestHeadSha>) =>
    mockFetchPullRequestHeadSha(...arguments_),
}));

mock.module("../reconciler/reconcile.ts", () => ({
  reconcilePullRequest: (...arguments_: Parameters<typeof mockReconcilePullRequest>) =>
    mockReconcilePullRequest(...arguments_),
}));

mock.module("../storage/jsonl.ts", () => ({
  writeJsonlFile: (...arguments_: Parameters<typeof mockWriteJsonlFile>) =>
    mockWriteJsonlFile(...arguments_),
}));

mock.module("../storage/markdown.ts", () => ({
  generateMarkdownSummary: (...arguments_: Parameters<typeof mockGenerateMarkdownSummary>) =>
    mockGenerateMarkdownSummary(...arguments_),
}));

import type { IngestOptions } from "./ingest.ts";

import { ingest } from "./ingest.ts";

function makeOptions(overrides: Partial<IngestOptions> = {}): IngestOptions {
  return {
    allowlist: ["coderabbitai[bot]"],
    branchName: "yamabiko-lite-inbox",
    eventPayload: {
      pull_request: { head: { ref: "feature", sha: "head-sha" }, number: 42 },
      repository: { name: "repo", owner: { login: "octo" } },
    },
    eventType: "pull_request_review_comment",
    token: "token",
    ...overrides,
  };
}

function makeRecord(overrides: Partial<InboxRecord> = {}): InboxRecord {
  return {
    body: "Please rename this variable",
    botLogin: "coderabbitai[bot]",
    commentId: 100,
    commentUrl: "https://github.com/octo/repo/pull/42#discussion_r100",
    createdAt: "2026-03-14T00:00:00.000Z",
    eventType: "pull_request_review_comment",
    headSha: "head-sha",
    id: "github-pull_request_review_comment-100",
    pullRequestNumber: 42,
    repository: { name: "repo", owner: "octo" },
    source: "github",
    status: "pending",
    updatedAt: "2026-03-14T00:00:00.000Z",
    ...overrides,
  };
}

let bunWriteMock: ReturnType<typeof spyOn>;

beforeEach(() => {
  mockCleanupWorktree.mockReset();
  mockCommitAndPushInbox.mockReset();
  mockEnsureInboxBranch.mockReset();
  mockReadFileFromBranch.mockReset();
  mockFetchPullRequestHeadSha.mockReset();
  mockReconcilePullRequest.mockReset();
  mockWriteJsonlFile.mockReset();
  mockGenerateMarkdownSummary.mockReset();

  mockEnsureInboxBranch.mockResolvedValue("/tmp/worktree");
  mockReadFileFromBranch.mockResolvedValue("");
  mockFetchPullRequestHeadSha.mockResolvedValue("api-head-sha");
  mockReconcilePullRequest.mockResolvedValue({
    added: 1,
    records: [makeRecord()],
    unchanged: 0,
    updated: 0,
  });
  mockWriteJsonlFile.mockResolvedValue();
  mockGenerateMarkdownSummary.mockReturnValue("# summary\n");
  mockCommitAndPushInbox.mockResolvedValue(true);
  mockCleanupWorktree.mockResolvedValue();
  bunWriteMock = spyOn(Bun, "write").mockResolvedValue(0);
});

afterEach(() => {
  bunWriteMock.mockRestore();
});

describe("ingest", () => {
  it("runs full ingest flow and returns reconciliation counters", async () => {
    const existing = makeRecord();
    mockReadFileFromBranch.mockResolvedValue(JSON.stringify(existing));
    const nextRecord = makeRecord({ body: "Updated text", updatedAt: "2026-03-15T00:00:00.000Z" });
    mockReconcilePullRequest.mockResolvedValue({
      added: 1,
      records: [nextRecord],
      unchanged: 3,
      updated: 2,
    });

    const result = await ingest(makeOptions());

    expect(result).toEqual({ added: 1, totalRecords: 1, unchanged: 3, updated: 2 });
    expect(mockEnsureInboxBranch).toHaveBeenCalledWith("yamabiko-lite-inbox");
    expect(mockFetchPullRequestHeadSha).not.toHaveBeenCalled();
    expect(mockReconcilePullRequest).toHaveBeenCalledWith({
      allowlist: ["coderabbitai[bot]"],
      existingRecords: [existing],
      headSha: "head-sha",
      owner: "octo",
      prNumber: 42,
      repo: "repo",
      token: "token",
    });
    expect(mockWriteJsonlFile).toHaveBeenCalledWith(
      path.join("/tmp/worktree", ".yamabiko-lite/inbox/octo/repo/pr-42.jsonl"),
      [nextRecord],
    );
    expect(bunWriteMock).toHaveBeenCalledWith(
      path.join("/tmp/worktree", ".yamabiko-lite/inbox/octo/repo/pr-42.md"),
      "# summary\n",
    );
    expect(mockCommitAndPushInbox).toHaveBeenCalledTimes(1);
    expect(mockCleanupWorktree).toHaveBeenCalledWith("/tmp/worktree");
  });

  it("returns zero counters for issue_comment without pull_request", async () => {
    const result = await ingest(
      makeOptions({
        eventPayload: {
          issue: { number: 42, state: "open" },
          repository: { name: "repo", owner: { login: "octo" } },
        },
        eventType: "issue_comment",
      }),
    );

    expect(result).toEqual({ added: 0, totalRecords: 0, unchanged: 0, updated: 0 });
    expect(mockEnsureInboxBranch).not.toHaveBeenCalled();
    expect(mockCleanupWorktree).not.toHaveBeenCalled();
  });

  it("creates records on first-ever run when branch file is missing", async () => {
    // eslint-disable-next-line unicorn/no-null -- branch reader returns null when file does not exist
    mockReadFileFromBranch.mockResolvedValue(null);
    const created = makeRecord({ id: "record-2" });
    mockReconcilePullRequest.mockResolvedValue({
      added: 1,
      records: [created],
      unchanged: 0,
      updated: 0,
    });

    const result = await ingest(
      makeOptions({
        eventPayload: {
          issue: {
            number: 42,
            pull_request: {
              html_url: "https://github.com/octo/repo/pull/42",
              url: "https://api.github.com/repos/octo/repo/pulls/42",
            },
            state: "open",
          },
          repository: { name: "repo", owner: { login: "octo" } },
        },
        eventType: "issue_comment",
      }),
    );

    expect(result).toEqual({ added: 1, totalRecords: 1, unchanged: 0, updated: 0 });
    expect(mockFetchPullRequestHeadSha).toHaveBeenCalledWith("octo", "repo", 42, "token");
    expect(mockReconcilePullRequest.mock.calls[0]?.[0].existingRecords).toEqual([]);
    expect(mockReconcilePullRequest.mock.calls[0]?.[0].headSha).toBe("api-head-sha");
  });

  it("passes existing records into reconciliation for upsert runs", async () => {
    const existing = makeRecord({ body: "Old body", id: "record-1" });
    mockReadFileFromBranch.mockResolvedValue(JSON.stringify(existing));
    const upserted = makeRecord({
      body: "New body",
      id: "record-1",
      updatedAt: "2026-03-16T00:00:00.000Z",
    });
    mockReconcilePullRequest.mockResolvedValue({
      added: 0,
      records: [upserted],
      unchanged: 0,
      updated: 1,
    });

    const result = await ingest(makeOptions());

    expect(result).toEqual({ added: 0, totalRecords: 1, unchanged: 0, updated: 1 });
    expect(mockReconcilePullRequest.mock.calls[0]?.[0].existingRecords).toEqual([existing]);
    expect(mockWriteJsonlFile).toHaveBeenCalledWith(
      path.join("/tmp/worktree", ".yamabiko-lite/inbox/octo/repo/pr-42.jsonl"),
      [upserted],
    );
  });

  it("always cleans up worktree when reconciliation throws", async () => {
    mockReconcilePullRequest.mockRejectedValue(new Error("reconcile failed"));

    let thrown: unknown;

    try {
      await ingest(makeOptions());
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("reconcile failed");

    expect(mockCleanupWorktree).toHaveBeenCalledWith("/tmp/worktree");
  });
});
