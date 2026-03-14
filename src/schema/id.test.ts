import { describe, expect, it } from "bun:test";

import { extractDeduplicationKey, generateRecordId } from "./id.ts";

describe("generateRecordId", () => {
  it("is deterministic: same input produces same ID", () => {
    const id1 = generateRecordId("github", "pull_request_review_comment", 123_456_789);
    const id2 = generateRecordId("github", "pull_request_review_comment", 123_456_789);
    expect(id1).toBe(id2);
  });

  it("produces different IDs for different sourceIds", () => {
    const id1 = generateRecordId("github", "pull_request_review_comment", 111);
    const id2 = generateRecordId("github", "pull_request_review_comment", 222);
    expect(id1).not.toBe(id2);
  });

  it("includes source, eventType, and sourceId in the output", () => {
    const id = generateRecordId("github", "pull_request_review_comment", 123_456_789);
    expect(id).toContain("github");
    expect(id).toContain("pull_request_review_comment");
    expect(id).toContain("123456789");
  });

  it("formats ID as {source}-{eventType}-{sourceId}", () => {
    const id = generateRecordId("github", "pull_request_review_comment", 123_456_789);
    expect(id).toBe("github-pull_request_review_comment-123456789");
  });

  it("works for review events with reviewId", () => {
    const id = generateRecordId("github", "pull_request_review", 987_654_321);
    expect(id).toBe("github-pull_request_review-987654321");
  });

  it("works for issue_comment events", () => {
    const id = generateRecordId("github", "issue_comment", 555);
    expect(id).toBe("github-issue_comment-555");
  });
});

describe("extractDeduplicationKey", () => {
  it("returns reviewId for pull_request_review events", () => {
    const key = extractDeduplicationKey({
      commentId: 0,
      eventType: "pull_request_review",
      reviewId: 987_654_321,
    });
    expect(key).toBe(987_654_321);
  });

  it("returns commentId for pull_request_review_comment events", () => {
    const key = extractDeduplicationKey({
      commentId: 123_456_789,
      eventType: "pull_request_review_comment",
      reviewId: 987_654_321,
    });
    expect(key).toBe(123_456_789);
  });

  it("returns commentId for issue_comment events", () => {
    const key = extractDeduplicationKey({
      commentId: 555,
      eventType: "issue_comment",
    });
    expect(key).toBe(555);
  });

  it("throws when pull_request_review event is missing reviewId", () => {
    expect(() =>
      extractDeduplicationKey({
        commentId: 0,
        eventType: "pull_request_review",
      }),
    ).toThrow();
  });

  it("throws when pull_request_review_comment event has commentId of 0", () => {
    expect(() =>
      extractDeduplicationKey({
        commentId: 0,
        eventType: "pull_request_review_comment",
      }),
    ).toThrow();
  });

  it("throws for unknown event types", () => {
    expect(() =>
      extractDeduplicationKey({
        commentId: 123,
        eventType: "unknown_event",
      }),
    ).toThrow();
  });
});
