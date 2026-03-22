import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import type { TimeProvider } from "./normalize";
import type {
  IssueCommentEvent,
  PullRequestReviewCommentEvent,
  PullRequestReviewEvent,
} from "./types";

import {
  normalizeEvent,
  normalizeIssueCommentEvent,
  normalizeReviewCommentEvent,
  normalizeReviewEvent,
} from "./normalize";

const providedHeadSha = "9999999999999999999999999999999999999999";
const fixedNow: TimeProvider = () => "2026-03-14T00:00:00Z";

function loadFixture<T>(name: string): T {
  const fileUrl = new URL(`__fixtures__/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileUrl, "utf8")) as T;
}

const reviewFixture = loadFixture<PullRequestReviewEvent>("pull-request-review.json");
const reviewCommentFixture = loadFixture<PullRequestReviewCommentEvent>(
  "pull-request-review-comment.json",
);
const issueCommentFixture = loadFixture<IssueCommentEvent>("issue-comment.json");

describe("normalizeReviewEvent", () => {
  it("maps pull_request_review into InboxRecord", () => {
    const record = normalizeReviewEvent(reviewFixture, fixedNow);

    expect(record).toMatchObject({
      body: "Please simplify this branch and avoid duplicate parsing.",
      botLogin: "coderabbitai[bot]",
      commentId: 710_001,
      commentUrl: "https://github.com/sankenbisha/yamabiko-lite/pull/42#pullrequestreview-710001",
      createdAt: "2026-03-14T00:00:00Z",
      eventType: "pull_request_review",
      headSha: "1111111111111111111111111111111111111111",
      id: "github-pull_request_review-710001",
      pullRequestNumber: 42,
      repository: { name: "yamabiko-lite", owner: "sankenbisha" },
      reviewId: 710_001,
      source: "github",
      status: "pending",
      updatedAt: "2026-03-14T00:00:00Z",
    });
  });

  it("uses review.commit_id instead of pull_request.head.sha", () => {
    const record = normalizeReviewEvent(reviewFixture);

    expect(record?.headSha).toBe("1111111111111111111111111111111111111111");
    expect(record?.headSha).not.toBe("2222222222222222222222222222222222222222");
  });
});

describe("normalizeReviewCommentEvent", () => {
  it("maps pull_request_review_comment into InboxRecord with path and line", () => {
    const record = normalizeReviewCommentEvent(reviewCommentFixture, fixedNow);

    expect(record).toMatchObject({
      body: "Inline: this branch is duplicated and can be flattened.",
      botLogin: "coderabbitai[bot]",
      commentId: 820_002,
      commentUrl: "https://github.com/sankenbisha/yamabiko-lite/pull/42#discussion_r820002",
      createdAt: "2026-03-14T00:05:00Z",
      eventType: "pull_request_review_comment",
      headSha: "3333333333333333333333333333333333333333",
      id: "github-pull_request_review_comment-820002",
      line: 120,
      path: "src/cli/check-inbox.ts",
      pullRequestNumber: 42,
      repository: { name: "yamabiko-lite", owner: "sankenbisha" },
      reviewId: 710_001,
      source: "github",
      status: "pending",
      updatedAt: "2026-03-14T00:06:00Z",
    });
  });
});

describe("normalizeIssueCommentEvent", () => {
  it("maps issue_comment into InboxRecord with provided headSha", () => {
    const record = normalizeIssueCommentEvent(issueCommentFixture, providedHeadSha, fixedNow);

    expect(record).toMatchObject({
      body: "General PR note: simplify this conditional and add coverage.",
      botLogin: "coderabbitai[bot]",
      commentId: 830_003,
      commentUrl: "https://github.com/sankenbisha/yamabiko-lite/pull/42#issuecomment-830003",
      createdAt: "2026-03-14T00:10:00Z",
      eventType: "issue_comment",
      headSha: providedHeadSha,
      id: "github-issue_comment-830003",
      pullRequestNumber: 42,
      repository: { name: "yamabiko-lite", owner: "sankenbisha" },
      source: "github",
      status: "pending",
      updatedAt: "2026-03-14T00:12:00Z",
    });
  });
});

describe("normalizeEvent", () => {
  it("returns null for empty or null body", () => {
    const nullBodyReview = structuredClone(reviewFixture);
    // eslint-disable-next-line unicorn/no-null
    nullBodyReview.review.body = null;

    const emptyBodyIssueComment = structuredClone(issueCommentFixture);
    emptyBodyIssueComment.comment.body = "";

    expect(normalizeReviewEvent(nullBodyReview)).toBeNull();
    expect(normalizeIssueCommentEvent(emptyBodyIssueComment, providedHeadSha)).toBeNull();
  });

  it("returns null for whitespace-only body", () => {
    const whitespaceReviewComment = structuredClone(reviewCommentFixture);
    whitespaceReviewComment.comment.body = "   \n\t  ";

    expect(normalizeReviewCommentEvent(whitespaceReviewComment)).toBeNull();
  });

  it("dispatches by event type and returns null for unsupported types", () => {
    const reviewRecord = normalizeEvent("pull_request_review", reviewFixture);
    const reviewCommentRecord = normalizeEvent("pull_request_review_comment", reviewCommentFixture);
    const issueCommentRecord = normalizeEvent(
      "issue_comment",
      issueCommentFixture,
      providedHeadSha,
    );

    expect(reviewRecord?.eventType).toBe("pull_request_review");
    expect(reviewCommentRecord?.eventType).toBe("pull_request_review_comment");
    expect(issueCommentRecord?.eventType).toBe("issue_comment");
    expect(normalizeEvent("push", issueCommentFixture)).toBeNull();
    // issue_comment without headSha returns null (headSha is required for issue_comment events)
    expect(normalizeEvent("issue_comment", issueCommentFixture)).toBeNull();
  });

  it("uses server-provided timestamps for reviews", () => {
    const record = normalizeEvent("pull_request_review", reviewFixture, undefined, fixedNow);

    expect(record?.createdAt).toBe("2026-03-14T00:00:00Z");
    expect(record?.updatedAt).toBe("2026-03-14T00:00:00Z");
  });

  it("uses injected time provider when timestamps are missing", () => {
    const issueCommentWithoutTimestamps = structuredClone(issueCommentFixture);
    delete issueCommentWithoutTimestamps.comment.created_at;
    delete issueCommentWithoutTimestamps.comment.updated_at;

    const reviewCommentWithoutTimestamps = structuredClone(reviewCommentFixture);
    delete reviewCommentWithoutTimestamps.comment.created_at;
    delete reviewCommentWithoutTimestamps.comment.updated_at;

    const reviewWithoutSubmittedAt = structuredClone(reviewFixture);
    // eslint-disable-next-line unicorn/no-null
    reviewWithoutSubmittedAt.review.submitted_at = null;

    const issueCommentRecord = normalizeEvent(
      "issue_comment",
      issueCommentWithoutTimestamps,
      providedHeadSha,
      fixedNow,
    );
    const reviewCommentRecord = normalizeEvent(
      "pull_request_review_comment",
      reviewCommentWithoutTimestamps,
      undefined,
      fixedNow,
    );
    const reviewRecord = normalizeEvent(
      "pull_request_review",
      reviewWithoutSubmittedAt,
      undefined,
      fixedNow,
    );

    expect(issueCommentRecord?.createdAt).toBe("2026-03-14T00:00:00Z");
    expect(issueCommentRecord?.updatedAt).toBe("2026-03-14T00:00:00Z");
    expect(reviewCommentRecord?.createdAt).toBe("2026-03-14T00:00:00Z");
    expect(reviewCommentRecord?.updatedAt).toBe("2026-03-14T00:00:00Z");
    expect(reviewRecord?.createdAt).toBe("2026-03-14T00:00:00Z");
    expect(reviewRecord?.updatedAt).toBe("2026-03-14T00:00:00Z");
  });

  it("returns null when payload validation fails", () => {
    const invalidIssuePayload = { comment: { body: "ok", id: 1 } };

    expect(
      normalizeEvent("issue_comment", invalidIssuePayload, providedHeadSha, fixedNow),
    ).toBeNull();
  });
});
