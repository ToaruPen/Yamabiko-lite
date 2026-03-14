import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  IssueCommentEvent,
  PullRequestReviewCommentEvent,
  PullRequestReviewEvent,
} from "./normalizer/types.ts";

import { applyClaimToRecords } from "./cli/commands/claim.ts";
import { normalizeEvent } from "./normalizer/normalize.ts";
import { parseInboxRecord, parseInboxRecords } from "./schema/inbox-record.ts";
import { assertValidTransition, isValidTransition } from "./schema/state.ts";
import { readJsonlFile, writeJsonlFile } from "./storage/jsonl.ts";
import { generateMarkdownSummary } from "./storage/markdown.ts";
import { upsertRecord, upsertRecords } from "./storage/upsert.ts";

const FIXTURE_HEAD_SHA = "9999999999999999999999999999999999999999";

let temporaryRoot = "";

beforeAll(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "yamabiko-test-"));
});

afterAll(async () => {
  if (temporaryRoot !== "") {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

function jsonlPathForRecord(record: {
  pullRequestNumber: number;
  repository: { name: string; owner: string };
}): string {
  return path.join(
    temporaryRoot,
    ".yamabiko-lite",
    "inbox",
    record.repository.owner,
    record.repository.name,
    `pr-${String(record.pullRequestNumber)}.jsonl`,
  );
}

function loadFixture<T>(name: string): T {
  const fileUrl = new URL(`normalizer/__fixtures__/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileUrl, "utf8")) as T;
}

describe("integration: module composition", () => {
  it("runs full pipeline: normalize -> upsert -> write JSONL -> read back", async () => {
    const payload = loadFixture<PullRequestReviewCommentEvent>("pull-request-review-comment.json");
    const normalized = normalizeEvent("pull_request_review_comment", payload);

    expect(normalized).not.toBeNull();
    if (normalized === null) {
      throw new Error("Expected normalized pull_request_review_comment record");
    }

    const records = upsertRecord([], normalized);
    const firstRecord = records[0];

    if (firstRecord === undefined) {
      throw new Error("Expected one record after initial upsert");
    }

    const jsonlPath = jsonlPathForRecord(firstRecord);

    await mkdir(path.dirname(jsonlPath), { recursive: true });
    await writeJsonlFile(jsonlPath, records);

    const persisted = await readJsonlFile(jsonlPath);
    const reparsed = parseInboxRecord(persisted[0]);

    expect(persisted).toEqual(records);
    expect(reparsed).toEqual(firstRecord);
  });

  it("handles claim + resolve flow to terminal status", async () => {
    const payload = loadFixture<PullRequestReviewEvent>("pull-request-review.json");
    const normalized = normalizeEvent("pull_request_review", payload);

    expect(normalized).not.toBeNull();
    if (normalized === null) {
      throw new Error("Expected normalized pull_request_review record");
    }

    const originalRecords = upsertRecord([], normalized);
    const { updatedRecords } = applyClaimToRecords(originalRecords, normalized.id);
    const claimed = updatedRecords.find((record) => record.id === normalized.id);

    expect(claimed?.status).toBe("claimed");
    if (claimed === undefined) {
      throw new Error("Expected claimed record to exist after claim flow");
    }

    assertValidTransition(claimed.status, "fixed");
    const resolved = updatedRecords.map((record) =>
      record.id === normalized.id
        ? { ...record, status: "fixed" as const, updatedAt: new Date().toISOString() }
        : record,
    );

    const firstResolved = resolved[0];
    if (firstResolved === undefined) {
      throw new Error("Expected one resolved record");
    }

    const jsonlPath = jsonlPathForRecord(firstResolved);
    await mkdir(path.dirname(jsonlPath), { recursive: true });
    await writeJsonlFile(jsonlPath, resolved);

    const persisted = await readJsonlFile(jsonlPath);
    const resolvedRecord = persisted.find((record) => record.id === normalized.id);

    expect(resolvedRecord?.status).toBe("fixed");
    expect(isValidTransition("fixed", "claimed")).toBeFalse();
  });

  it("excludes stale records when current head SHA differs", () => {
    const payload = loadFixture<IssueCommentEvent>("issue-comment.json");
    const normalized = normalizeEvent("issue_comment", payload, FIXTURE_HEAD_SHA);

    expect(normalized).not.toBeNull();
    if (normalized === null) {
      throw new Error("Expected normalized issue_comment record");
    }

    const existing = upsertRecord([], normalized);
    const filtered = existing.filter((record) => {
      const currentHeadSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      return record.status !== "stale" && record.headSha === currentHeadSha;
    });

    expect(filtered).toEqual([]);
  });

  it("deduplicates same normalized event via upsert", () => {
    const payload = loadFixture<PullRequestReviewEvent>("pull-request-review.json");
    const first = normalizeEvent("pull_request_review", payload);
    const second = normalizeEvent("pull_request_review", payload);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (first === null || second === null) {
      throw new Error("Expected normalized pull_request_review records");
    }

    const merged = upsertRecords([], [first, second]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe(first?.id);
  });

  it("generates markdown summary with accurate mixed-status counts", () => {
    const payload = loadFixture<PullRequestReviewCommentEvent>("pull-request-review-comment.json");
    const normalized = normalizeEvent("pull_request_review_comment", payload);

    expect(normalized).not.toBeNull();
    if (normalized === null) {
      throw new Error("Expected normalized pull_request_review_comment record");
    }

    const pending = normalized;
    const claimed = {
      ...pending,
      commentId: pending.commentId + 1,
      id: `${pending.id}-claimed`,
      status: "claimed" as const,
    };
    const fixed = {
      ...pending,
      commentId: pending.commentId + 2,
      id: `${pending.id}-fixed`,
      status: "fixed" as const,
    };

    const markdown = generateMarkdownSummary([pending, claimed, fixed], pending.pullRequestNumber, {
      name: pending.repository.name,
      owner: pending.repository.owner,
    });

    expect(markdown).toContain("**1** pending");
    expect(markdown).toContain("**1** claimed");
    expect(markdown).toContain("**1** fixed");
    expect(markdown).toContain("**0** skipped");
    expect(markdown).toContain("**0** stale");
  });

  it("round-trips payload through normalize -> JSONL text -> parse", async () => {
    const payload = loadFixture<PullRequestReviewEvent>("pull-request-review.json");
    const normalized = normalizeEvent("pull_request_review", payload);

    expect(normalized).not.toBeNull();
    if (normalized === null) {
      throw new Error("Expected normalized pull_request_review record");
    }

    const jsonlPath = jsonlPathForRecord(normalized);
    await mkdir(path.dirname(jsonlPath), { recursive: true });
    await writeJsonlFile(jsonlPath, [normalized]);

    const jsonlContent = await Bun.file(jsonlPath).text();
    const parsed = parseInboxRecords(jsonlContent);

    expect(parsed).toEqual([normalized]);
  });
});
