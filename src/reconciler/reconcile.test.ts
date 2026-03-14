import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

import type { GitHubIssueComment, GitHubReview, GitHubReviewComment } from "../api/github.ts";
import type { InboxRecord } from "../schema/inbox-record.ts";

import * as githubApi from "../api/github.ts";
import { reconcilePullRequest } from "./reconcile.ts";

const baseOptions = {
  allowlist: ["coderabbitai[bot]"],
  existingRecords: [] as readonly InboxRecord[],
  headSha: "head-sha-42",
  owner: "acme",
  prNumber: 42,
  repo: "yamabiko-lite",
  token: "ghs_test",
};

afterEach(() => {
  mock.restore();
});

function makeExistingRecord(overrides: Partial<InboxRecord> = {}): InboxRecord {
  return {
    body: "old body",
    botLogin: "coderabbitai[bot]",
    commentId: 1,
    commentUrl: "https://github.com/acme/yamabiko-lite/pull/42#pullrequestreview-1",
    createdAt: "2026-03-01T00:00:00Z",
    eventType: "pull_request_review",
    headSha: "old-head",
    id: "github-pull_request_review-1",
    pullRequestNumber: 42,
    repository: { name: "yamabiko-lite", owner: "acme" },
    reviewId: 1,
    source: "github",
    status: "pending",
    updatedAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

function makeIssueComment(overrides: Partial<GitHubIssueComment> = {}): GitHubIssueComment {
  return {
    body: "issue comment body",
    created_at: "2026-03-14T00:01:00Z",
    html_url: "https://github.com/acme/yamabiko-lite/pull/42#issuecomment-3",
    id: 1,
    updated_at: "2026-03-14T00:02:00Z",
    user: { id: 12, login: "coderabbitai[bot]", type: "Bot" },
    ...overrides,
  };
}

function makeReview(overrides: Partial<GitHubReview> = {}): GitHubReview {
  return {
    body: "review body",
    commit_id: "review-commit",
    html_url: "https://github.com/acme/yamabiko-lite/pull/42#pullrequestreview-1",
    id: 2,
    state: "commented",
    submitted_at: "2026-03-14T00:00:00Z",
    user: { id: 10, login: "coderabbitai[bot]", type: "Bot" },
    ...overrides,
  };
}

function makeReviewComment(overrides: Partial<GitHubReviewComment> = {}): GitHubReviewComment {
  return {
    body: "review comment body",
    commit_id: "comment-commit",
    created_at: "2026-03-14T00:03:00Z",
    html_url: "https://github.com/acme/yamabiko-lite/pull/42#discussion_r2",
    id: 3,
    line: 12,
    path: "src/index.ts",
    pull_request_review_id: 1,
    updated_at: "2026-03-14T00:04:00Z",
    user: { id: 11, login: "coderabbitai[bot]", type: "Bot" },
    ...overrides,
  };
}

describe("reconcilePullRequest", () => {
  it("adds 3 new records when existing is empty", async () => {
    spyOn(githubApi, "fetchPullRequestReviews").mockResolvedValue([makeReview()]);
    spyOn(githubApi, "fetchPullRequestComments").mockResolvedValue([makeReviewComment()]);
    spyOn(githubApi, "fetchIssueComments").mockResolvedValue([makeIssueComment()]);

    const result = await reconcilePullRequest(baseOptions);

    expect(result.records).toHaveLength(3);
    expect(result.added).toBe(3);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);

    const reviewRecord = result.records.find(
      (record) => record.eventType === "pull_request_review",
    );
    const reviewCommentRecord = result.records.find(
      (record) => record.eventType === "pull_request_review_comment",
    );
    const issueCommentRecord = result.records.find(
      (record) => record.eventType === "issue_comment",
    );

    expect(reviewRecord?.headSha).toBe("review-commit");
    expect(reviewCommentRecord?.headSha).toBe("comment-commit");
    expect(issueCommentRecord?.headSha).toBe(baseOptions.headSha);
  });

  it("reports one updated and one unchanged when one existing record matches API payload", async () => {
    const existing = [
      makeExistingRecord(),
      makeExistingRecord({
        commentId: 999,
        commentUrl: "https://github.com/acme/yamabiko-lite/pull/42#pullrequestreview-999",
        id: "github-pull_request_review-999",
        reviewId: 999,
      }),
    ];

    spyOn(githubApi, "fetchPullRequestReviews").mockResolvedValue([
      makeReview({ body: "new body from api", id: 1 }),
    ]);
    spyOn(githubApi, "fetchPullRequestComments").mockResolvedValue([]);
    spyOn(githubApi, "fetchIssueComments").mockResolvedValue([]);

    const result = await reconcilePullRequest({ ...baseOptions, existingRecords: existing });

    expect(result.added).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.records).toHaveLength(2);
  });

  it("keeps only allowed bots from mixed bot and human comments", async () => {
    spyOn(githubApi, "fetchPullRequestReviews").mockResolvedValue([
      makeReview({ id: 10, user: { id: 10, login: "coderabbitai[bot]", type: "Bot" } }),
      makeReview({ id: 11, user: { id: 11, login: "octocat", type: "User" } }),
    ]);
    spyOn(githubApi, "fetchPullRequestComments").mockResolvedValue([
      makeReviewComment({ id: 12, user: { id: 12, login: "coderabbitai[bot]", type: "Bot" } }),
      makeReviewComment({ id: 13, user: { id: 13, login: "dev-user", type: "User" } }),
    ]);
    spyOn(githubApi, "fetchIssueComments").mockResolvedValue([
      makeIssueComment({ id: 14, user: { id: 14, login: "coderabbitai[bot]", type: "Bot" } }),
    ]);

    const result = await reconcilePullRequest(baseOptions);

    expect(result.records).toHaveLength(3);
    expect(result.records.every((record) => record.botLogin === "coderabbitai[bot]")).toBeTrue();
  });

  it("filters out empty body comments via normalizer", async () => {
    spyOn(githubApi, "fetchPullRequestReviews").mockResolvedValue([
      // eslint-disable-next-line unicorn/no-null
      makeReview({ body: null, id: 20 }),
      makeReview({ body: "valid review", id: 21 }),
    ]);
    spyOn(githubApi, "fetchPullRequestComments").mockResolvedValue([
      makeReviewComment({ body: "   ", id: 22 }),
    ]);
    spyOn(githubApi, "fetchIssueComments").mockResolvedValue([
      makeIssueComment({ body: "", id: 23 }),
    ]);

    const result = await reconcilePullRequest(baseOptions);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.body).toBe("valid review");
  });

  it("retries once on transient API failure and succeeds", async () => {
    let reviewAttempts = 0;
    const sleepSpy = spyOn(Bun, "sleep").mockImplementation(() => Promise.resolve());

    spyOn(githubApi, "fetchPullRequestReviews").mockImplementation(async () => {
      reviewAttempts += 1;
      if (reviewAttempts === 1) {
        throw new Error("GitHub API error: 500");
      }
      return [makeReview({ id: 30 })];
    });
    spyOn(githubApi, "fetchPullRequestComments").mockResolvedValue([]);
    spyOn(githubApi, "fetchIssueComments").mockResolvedValue([]);

    const result = await reconcilePullRequest(baseOptions);

    expect(result.records).toHaveLength(1);
    expect(reviewAttempts).toBe(2);
    expect(sleepSpy).toHaveBeenCalledTimes(1);
    expect(sleepSpy).toHaveBeenCalledWith(1000);
  });

  it("retries on rate limit error (403)", async () => {
    let reviewAttempts = 0;
    const sleepSpy = spyOn(Bun, "sleep").mockImplementation(() => Promise.resolve());

    spyOn(githubApi, "fetchPullRequestReviews").mockImplementation(async () => {
      reviewAttempts += 1;
      if (reviewAttempts === 1) {
        throw new Error("Rate limit exceeded");
      }
      return [makeReview({ id: 50 })];
    });
    spyOn(githubApi, "fetchPullRequestComments").mockResolvedValue([]);
    spyOn(githubApi, "fetchIssueComments").mockResolvedValue([]);

    const result = await reconcilePullRequest(baseOptions);

    expect(result.records).toHaveLength(1);
    expect(reviewAttempts).toBe(2);
    expect(sleepSpy).toHaveBeenCalledTimes(1);
    expect(sleepSpy).toHaveBeenCalledWith(1000);
  });

  it("reconciles all event types in one execution", async () => {
    spyOn(githubApi, "fetchPullRequestReviews").mockResolvedValue([
      makeReview({ body: "review A", id: 41 }),
    ]);
    spyOn(githubApi, "fetchPullRequestComments").mockResolvedValue([
      makeReviewComment({ body: "comment B", id: 42, path: "src/reconciler/reconcile.ts" }),
    ]);
    spyOn(githubApi, "fetchIssueComments").mockResolvedValue([
      makeIssueComment({ body: "issue C", id: 43 }),
    ]);

    const result = await reconcilePullRequest(baseOptions);
    const eventTypes = result.records.map((record) => record.eventType);

    expect(result.records).toHaveLength(3);
    expect(eventTypes).toContain("issue_comment");
    expect(eventTypes).toContain("pull_request_review");
    expect(eventTypes).toContain("pull_request_review_comment");
  });
});
