import { describe, expect, it } from "bun:test";

import type { InboxRecord } from "../../schema/inbox-record.ts";

import { applyClaimToRecords } from "./claim.ts";

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
