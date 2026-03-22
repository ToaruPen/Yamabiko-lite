import { describe, expect, it } from "bun:test";
import { ValiError } from "valibot";

import { parseInboxRecord, parseInboxRecords } from "./inbox-record.ts";

const validRecord = {
  body: "Please simplify this branch and avoid duplicate parsing.",
  botLogin: "coderabbitai",
  commentId: 123_456_789,
  commentUrl: "https://github.com/OWNER/REPO/pull/42#discussion_r123456789",
  createdAt: "2026-03-14T00:00:00.000Z",
  eventType: "pull_request_review_comment",
  headSha: "abc123",
  id: "github-review-comment-123456789",
  line: 120,
  path: "src/foo.ts",
  pullRequestNumber: 42,
  repository: {
    name: "REPO",
    owner: "OWNER",
  },
  reviewId: 987_654_321,
  source: "github",
  status: "pending",
  updatedAt: "2026-03-14T00:00:00.000Z",
} as const;

function expectFieldMentioned(error: unknown, field: string): void {
  if (error instanceof ValiError) {
    const mention = JSON.stringify(error.issues);
    expect(mention).toContain(field);
    return;
  }

  if (error instanceof Error) {
    expect(error.message).toContain(field);
    return;
  }

  throw new Error(`Unexpected error type: ${String(error)}`);
}

describe("parseInboxRecord", () => {
  it("validates a full valid record", () => {
    const parsed = parseInboxRecord(validRecord);

    expect(parsed).toEqual(validRecord);
  });

  it("rejects each missing required field and mentions the field", () => {
    const requiredFields = [
      "id",
      "source",
      "eventType",
      "repository",
      "pullRequestNumber",
      "commentUrl",
      "commentId",
      "botLogin",
      "body",
      "headSha",
      "status",
      "createdAt",
      "updatedAt",
    ] as const;

    for (const field of requiredFields) {
      const invalid = { ...validRecord } as Record<string, unknown>;
      Reflect.deleteProperty(invalid, field);

      try {
        parseInboxRecord(invalid);
        throw new Error(`Expected validation failure for missing ${field}`);
      } catch (error) {
        expectFieldMentioned(error, field);
      }
    }
  });

  it("accepts records without optional path, line, and reviewId", () => {
    const withoutOptional = {
      ...validRecord,
    } as Record<string, unknown>;

    Reflect.deleteProperty(withoutOptional, "path");
    Reflect.deleteProperty(withoutOptional, "line");
    Reflect.deleteProperty(withoutOptional, "reviewId");

    const parsed = parseInboxRecord(withoutOptional);
    expect(parsed.path).toBeUndefined();
    expect(parsed.line).toBeUndefined();
    expect(parsed.reviewId).toBeUndefined();
  });

  it("rejects invalid status values", () => {
    const invalid = {
      ...validRecord,
      status: "done",
    };

    expect(() => parseInboxRecord(invalid)).toThrow(ValiError);
  });

  it("rejects invalid eventType values", () => {
    const invalid = {
      ...validRecord,
      eventType: "pull_request",
    };

    expect(() => parseInboxRecord(invalid)).toThrow(ValiError);
  });
});

describe("parseInboxRecords", () => {
  it("parses multiple JSONL lines", () => {
    const second = {
      ...validRecord,
      commentId: 222,
      id: "github-review-comment-222",
      updatedAt: "2026-03-14T00:10:00.000Z",
    };
    const content = `${JSON.stringify(validRecord)}\n${JSON.stringify(second)}`;

    const parsed = parseInboxRecords(content);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.id).toBe(validRecord.id);
    expect(parsed[1]?.id).toBe(second.id);
  });

  it("skips empty lines in JSONL input", () => {
    const content = `\n${JSON.stringify(validRecord)}\n\n`;

    const parsed = parseInboxRecords(content);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe(validRecord.id);
  });

  it("skips invalid JSON lines without throwing", () => {
    const content = `${JSON.stringify(validRecord)}\n{invalid json}\n${JSON.stringify({ ...validRecord, commentId: 2, id: "ok-2" })}`;

    expect(() => parseInboxRecords(content)).not.toThrow();
    const parsed = parseInboxRecords(content);
    expect(parsed).toHaveLength(2);
  });

  it("calls onWarning callback for invalid JSONL lines", () => {
    const content = `${JSON.stringify(validRecord)}\n{invalid json\n`;
    const warnings: { line: number; message: string }[] = [];

    const records = parseInboxRecords(content, (line, message) => {
      warnings.push({ line, message });
    });

    expect(records).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.line).toBe(2);
    expect(warnings[0]!.message.trim().length).toBeGreaterThan(0);
  });

  it("calls onWarning callback for schema validation failures", () => {
    const content = `${JSON.stringify(validRecord)}\n${JSON.stringify({ garbage: true })}\n`;
    const warnings: { line: number; message: string }[] = [];

    const records = parseInboxRecords(content, (line, message) => {
      warnings.push({ line, message });
    });

    expect(records).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.line).toBe(2);
    expect(warnings[0]!.message.trim().length).toBeGreaterThan(0);
  });
});
