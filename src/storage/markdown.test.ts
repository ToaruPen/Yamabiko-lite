import { describe, expect, it } from "bun:test";

import type { InboxRecord } from "../schema/inbox-record.ts";

import { generateMarkdownSummary } from "./markdown.ts";

function makeRecord(overrides: Partial<InboxRecord> = {}): InboxRecord {
  return {
    body: "Default body text",
    botLogin: "test-bot",
    commentId: 1,
    commentUrl: "https://github.com/owner/repo/pull/1#comment-1",
    createdAt: "2025-01-01T00:00:00Z",
    eventType: "pull_request_review_comment",
    headSha: "abc123",
    id: "rec-001",
    pullRequestNumber: 1,
    repository: { name: "repo", owner: "owner" },
    source: "test",
    status: "pending",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

const REPO = { name: "widgets", owner: "acme" };

describe("generateMarkdownSummary", () => {
  describe("empty records", () => {
    it("produces header and all-zero counts with no table rows", () => {
      const md = generateMarkdownSummary([], 42, REPO);

      expect(md).toContain("# Inbox Summary: acme/widgets PR #42");
      expect(md).toContain("**0** pending");
      expect(md).toContain("**0** claimed");
      expect(md).toContain("**0** fixed");
      expect(md).toContain("**0** skipped");
      expect(md).toContain("**0** stale");
      expect(md).not.toContain("| pending");
      expect(md).not.toContain("| claimed");
    });
  });

  describe("table rows", () => {
    it("renders 3 records as 3 table rows with correct columns", () => {
      const records: InboxRecord[] = [
        makeRecord({
          body: "Fix this issue",
          botLogin: "bot-a",
          commentUrl: "https://github.com/acme/widgets/pull/7#r1",
          id: "r1",
          line: 10,
          path: "src/foo.ts",
          status: "pending",
        }),
        makeRecord({
          body: "Looks good now",
          botLogin: "bot-b",
          commentUrl: "https://github.com/acme/widgets/pull/7#r2",
          id: "r2",
          path: "src/bar.ts",
          status: "fixed",
        }),
        makeRecord({
          body: "Not relevant",
          botLogin: "bot-a",
          commentUrl: "https://github.com/acme/widgets/pull/7#r3",
          id: "r3",
          status: "skipped",
        }),
      ];

      const md = generateMarkdownSummary(records, 7, REPO);
      const lines = md.split("\n");
      const dataRows = lines.filter(
        (l) => l.startsWith("|") && !l.startsWith("| Status") && !l.startsWith("| ---"),
      );

      expect(dataRows).toHaveLength(3);
      expect(md).toContain("| r1 |");
      expect(md).toContain("| bot-a |");
      expect(md).toContain("src/foo.ts:10");
      expect(md).toContain("[comment](https://github.com/acme/widgets/pull/7#r1)");
      expect(md).toContain("src/bar.ts");
      expect(md).not.toContain("src/bar.ts:");
    });
  });

  describe("sorting", () => {
    it("places pending and claimed items before fixed, skipped, and stale", () => {
      const records: InboxRecord[] = [
        makeRecord({ id: "fixed-1", status: "fixed" }),
        makeRecord({ id: "pending-1", status: "pending" }),
        makeRecord({ id: "stale-1", status: "stale" }),
        makeRecord({ id: "claimed-1", status: "claimed" }),
        makeRecord({ id: "skipped-1", status: "skipped" }),
      ];

      const md = generateMarkdownSummary(records, 1, REPO);
      const lines = md.split("\n");
      const dataRows = lines.filter(
        (l) => l.startsWith("|") && !l.startsWith("| Status") && !l.startsWith("| ---"),
      );

      const ids = dataRows.map((row) => {
        const cols = row.split("|").map((c) => c.trim());
        return cols[2];
      });

      const pendingIndex = ids.indexOf("pending-1");
      const claimedIndex = ids.indexOf("claimed-1");
      const fixedIndex = ids.indexOf("fixed-1");
      const skippedIndex = ids.indexOf("skipped-1");
      const staleIndex = ids.indexOf("stale-1");

      expect(pendingIndex).toBeLessThan(fixedIndex);
      expect(pendingIndex).toBeLessThan(skippedIndex);
      expect(pendingIndex).toBeLessThan(staleIndex);
      expect(claimedIndex).toBeLessThan(fixedIndex);
      expect(claimedIndex).toBeLessThan(skippedIndex);
      expect(claimedIndex).toBeLessThan(staleIndex);
    });
  });

  describe("body truncation", () => {
    it("truncates body to 80 chars and appends ... when longer", () => {
      const longBody = "A".repeat(100);
      const records = [makeRecord({ body: longBody })];

      const md = generateMarkdownSummary(records, 1, REPO);

      expect(md).toContain("A".repeat(80) + "...");
      expect(md).not.toContain("A".repeat(81) + " ");
    });

    it("does not truncate body that is exactly 80 chars", () => {
      const exactBody = "B".repeat(80);
      const records = [makeRecord({ body: exactBody })];

      const md = generateMarkdownSummary(records, 1, REPO);

      expect(md).toContain(exactBody);
      expect(md).not.toContain(exactBody + "...");
    });

    it("escapes pipe and replaces newlines in table summary cells", () => {
      const records = [
        makeRecord({
          body: "line one | line two\nline three",
          id: "escape-1",
          status: "pending",
        }),
      ];

      const md = generateMarkdownSummary(records, 1, REPO);

      expect(md).toContain(String.raw`line one \| line two line three`);
      expect(md).not.toContain("line two\nline three");
    });
  });

  describe("counts accuracy", () => {
    it("counts line matches actual record statuses", () => {
      const records: InboxRecord[] = [
        makeRecord({ status: "pending" }),
        makeRecord({ status: "pending" }),
        makeRecord({ status: "claimed" }),
        makeRecord({ status: "fixed" }),
        makeRecord({ status: "fixed" }),
        makeRecord({ status: "fixed" }),
        makeRecord({ status: "skipped" }),
        makeRecord({ status: "stale" }),
        makeRecord({ status: "stale" }),
      ];

      const md = generateMarkdownSummary(records, 5, REPO);

      expect(md).toContain("**2** pending");
      expect(md).toContain("**1** claimed");
      expect(md).toContain("**3** fixed");
      expect(md).toContain("**1** skipped");
      expect(md).toContain("**2** stale");
    });
  });
});
