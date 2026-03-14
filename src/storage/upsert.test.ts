import { describe, expect, test } from "bun:test";

import type { InboxRecord } from "../schema/inbox-record.ts";

import { upsertRecord, upsertRecords } from "./upsert.ts";

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

describe("upsertRecord", () => {
  test("inserts a new record into an empty array", () => {
    const incoming = makeRecord();
    const result = upsertRecord([], incoming);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(incoming);
  });

  test("updates body, headSha, updatedAt while preserving status and createdAt", () => {
    const existing = makeRecord({
      body: "old body",
      createdAt: "2026-03-01T00:00:00Z",
      headSha: "old-sha",
      status: "pending",
      updatedAt: "2026-03-01T00:00:00Z",
    });
    const incoming = makeRecord({
      body: "new body",
      createdAt: "2026-03-10T00:00:00Z",
      headSha: "new-sha",
      status: "claimed",
      updatedAt: "2026-03-10T00:00:00Z",
    });

    const result = upsertRecord([existing], incoming);

    expect(result).toHaveLength(1);
    expect(result[0]!.body).toBe("new body");
    expect(result[0]!.headSha).toBe("new-sha");
    expect(result[0]!.updatedAt).toBe("2026-03-10T00:00:00Z");
    expect(result[0]!.status).toBe("pending");
    expect(result[0]!.createdAt).toBe("2026-03-01T00:00:00Z");
  });

  test("does not duplicate when an identical record is upserted", () => {
    const record = makeRecord();
    const result = upsertRecord([record], record);

    expect(result).toHaveLength(1);
  });

  test("preserves claimed status when incoming has different status", () => {
    const existing = makeRecord({ status: "claimed" });
    const incoming = makeRecord({
      body: "updated body",
      headSha: "new-sha",
      status: "pending",
      updatedAt: "2026-03-15T00:00:00Z",
    });

    const result = upsertRecord([existing], incoming);

    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe("claimed");
    expect(result[0]!.body).toBe("updated body");
  });

  test("preserves commentId, repository, and source on update", () => {
    const existing = makeRecord({
      commentId: 200,
      repository: { name: "my-repo", owner: "my-owner" },
      source: "github",
    });
    const incoming = makeRecord({
      body: "updated",
      commentId: 200,
      headSha: "new-sha",
      id: existing.id,
      repository: { name: "my-repo", owner: "my-owner" },
      source: "github",
      updatedAt: "2026-03-20T00:00:00Z",
    });

    const result = upsertRecord([existing], incoming);

    expect(result).toHaveLength(1);
    expect(result[0]!.commentId).toBe(200);
    expect(result[0]!.repository).toEqual({ name: "my-repo", owner: "my-owner" });
    expect(result[0]!.source).toBe("github");
  });
});

describe("upsertRecords", () => {
  test("batch upsert: 1 new + 1 update across 3 existing records → 4 records", () => {
    const existing = [
      makeRecord({ commentId: 1, id: "github-pull_request_review_comment-1" }),
      makeRecord({ commentId: 2, id: "github-pull_request_review_comment-2" }),
      makeRecord({ commentId: 3, id: "github-pull_request_review_comment-3" }),
    ];
    const incoming = [
      makeRecord({
        body: "updated body for 2",
        commentId: 2,
        headSha: "updated-sha",
        id: "github-pull_request_review_comment-2",
        updatedAt: "2026-03-20T00:00:00Z",
      }),
      makeRecord({ commentId: 4, id: "github-pull_request_review_comment-4" }),
    ];

    const result = upsertRecords(existing, incoming);

    expect(result).toHaveLength(4);
    const updated = result.find((r) => r.id === "github-pull_request_review_comment-2");
    expect(updated!.body).toBe("updated body for 2");
    expect(updated!.headSha).toBe("updated-sha");
    const appended = result.find((r) => r.id === "github-pull_request_review_comment-4");
    expect(appended).toBeDefined();
  });
});
