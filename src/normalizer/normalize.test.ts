import { describe, expect, it } from "bun:test";
import {
  normalizeEvent,
  normalizeIssueCommentEvent,
  normalizeReviewCommentEvent,
  normalizeReviewEvent,
} from "./normalize";
import type {
  IssueCommentEvent,
  PullRequestReviewCommentEvent,
  PullRequestReviewEvent,
} from "./types";

const providedHeadSha = "9999999999999999999999999999999999999999";

function loadFixture<T>(name: string): T {
  const fileUrl = new URL(`./__fixtures__/${name}`, import.meta.url);
  return JSON.parse(Bun.file(fileUrl).textSync()) as T;
}

const reviewFixture = loadFixture<PullRequestReviewEvent>("pull-request-review.json");
const reviewCommentFixture = loadFixture<PullRequestReviewCommentEvent>(
  "pull-request-review-comment.json",
);
const issueCommentFixture = loadFixture<IssueCommentEvent>("issue-comment.json");

describe("normalizeReviewEvent", () => {
  it("maps pull_request_review into InboxRecord", () => {
    const record = normalizeReviewEvent(reviewFixture);

    expect(record).toMatchObject({
      id: "github-pull_request_review-710001",
      source: "github",
      eventType: "pull_request_review",
      repository: { owner: "sankenbisha", name: "yamabiko-lite" },
      pullRequestNumber: 42,
      commentUrl: "https://github.com/sankenbisha/yamabiko-lite/pull/42#pullrequestreview-710001",
      commentId: 710001,
      reviewId: 710001,
      botLogin: "coderabbitai[bot]",
      body: "Please simplify this branch and avoid duplicate parsing.",
      headSha: "2222222222222222222222222222222222222222",
      status: "pending",
    });
  });

  it("uses pull_request.head.sha instead of review.commit_id", () => {
    const record = normalizeReviewEvent(reviewFixture);

    expect(record?.headSha).toBe("2222222222222222222222222222222222222222");
    expect(record?.headSha).not.toBe("1111111111111111111111111111111111111111");
  });
});

describe("normalizeReviewCommentEvent", () => {
  it("maps pull_request_review_comment into InboxRecord with path and line", () => {
    const record = normalizeReviewCommentEvent(reviewCommentFixture);

    expect(record).toMatchObject({
      id: "github-pull_request_review_comment-820002",
      source: "github",
      eventType: "pull_request_review_comment",
      repository: { owner: "sankenbisha", name: "yamabiko-lite" },
      pullRequestNumber: 42,
      commentUrl: "https://github.com/sankenbisha/yamabiko-lite/pull/42#discussion_r820002",
      commentId: 820002,
      reviewId: 710001,
      botLogin: "coderabbitai[bot]",
      body: "Inline: this branch is duplicated and can be flattened.",
      path: "src/cli/check-inbox.ts",
      line: 120,
      headSha: "4444444444444444444444444444444444444444",
      status: "pending",
    });
  });
});

describe("normalizeIssueCommentEvent", () => {
  it("maps issue_comment into InboxRecord with provided headSha", () => {
    const record = normalizeIssueCommentEvent(issueCommentFixture, providedHeadSha);

    expect(record).toMatchObject({
      id: "github-issue_comment-830003",
      source: "github",
      eventType: "issue_comment",
      repository: { owner: "sankenbisha", name: "yamabiko-lite" },
      pullRequestNumber: 42,
      commentUrl: "https://github.com/sankenbisha/yamabiko-lite/pull/42#issuecomment-830003",
      commentId: 830003,
      botLogin: "coderabbitai[bot]",
      body: "General PR note: simplify this conditional and add coverage.",
      headSha: providedHeadSha,
      status: "pending",
    });
  });
});

describe("normalizeEvent", () => {
  it("returns null for empty or null body", () => {
    const nullBodyReview = structuredClone(reviewFixture);
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
    expect(normalizeEvent("issue_comment", issueCommentFixture)).toBeNull();
  });

  it("sets createdAt and updatedAt as ISO strings", () => {
    const record = normalizeEvent("pull_request_review", reviewFixture);

    expect(record).not.toBeNull();

    const createdAtIso = new Date(record!.createdAt).toISOString();
    const updatedAtIso = new Date(record!.updatedAt).toISOString();

    expect(record?.createdAt).toBe(createdAtIso);
    expect(record?.updatedAt).toBe(updatedAtIso);
  });
});
