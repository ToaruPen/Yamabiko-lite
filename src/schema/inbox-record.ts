import {
  type InferOutput,
  literal,
  number,
  object,
  optional,
  parse,
  safeParse,
  string,
  union,
} from "valibot";

export interface InboxRecord {
  body: string;
  botLogin: string;
  commentId: number;
  commentUrl: string;
  createdAt: string;
  eventType: "issue_comment" | "pull_request_review" | "pull_request_review_comment";
  headSha: string;
  id: string;
  line?: number;
  path?: string;
  pullRequestNumber: number;
  repository: {
    name: string;
    owner: string;
  };
  reviewId?: number;
  source: string;
  status: "claimed" | "fixed" | "pending" | "skipped" | "stale";
  updatedAt: string;
}

const EventTypeSchema = union([
  literal("pull_request_review"),
  literal("pull_request_review_comment"),
  literal("issue_comment"),
]);

const StatusSchema = union([
  literal("pending"),
  literal("claimed"),
  literal("fixed"),
  literal("skipped"),
  literal("stale"),
]);

const InboxRecordSchema = object({
  body: string(),
  botLogin: string(),
  commentId: number(),
  commentUrl: string(),
  createdAt: string(),
  eventType: EventTypeSchema,
  headSha: string(),
  id: string(),
  line: optional(number()),
  path: optional(string()),
  pullRequestNumber: number(),
  repository: object({
    name: string(),
    owner: string(),
  }),
  reviewId: optional(number()),
  source: string(),
  status: StatusSchema,
  updatedAt: string(),
});

type ParsedInboxRecord = InferOutput<typeof InboxRecordSchema>;

export function parseInboxRecord(raw: unknown): InboxRecord {
  const parsed = parse(InboxRecordSchema, raw);
  return normalizeOptionalFields(parsed);
}

export function parseInboxRecords(jsonlContent: string): InboxRecord[] {
  const records: InboxRecord[] = [];
  const lines = jsonlContent.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (!line || line.trim() === "") {
      continue;
    }

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[inbox-record] Skipping invalid JSONL line ${String(index + 1)}: ${message}`);
      continue;
    }

    const result = safeParse(InboxRecordSchema, parsedJson);

    if (result.success) {
      records.push(normalizeOptionalFields(result.output));
      continue;
    }

    const issues = result.issues
      .map((issue) => {
        const key = issue.path?.[0]?.key;
        return typeof key === "string" ? key : issue.message;
      })
      .join(", ");

    console.warn(`[inbox-record] Skipping invalid record on line ${String(index + 1)}: ${issues}`);
  }

  return records;
}

function normalizeOptionalFields(record: ParsedInboxRecord): InboxRecord {
  const normalized: InboxRecord = {
    body: record.body,
    botLogin: record.botLogin,
    commentId: record.commentId,
    commentUrl: record.commentUrl,
    createdAt: record.createdAt,
    eventType: record.eventType,
    headSha: record.headSha,
    id: record.id,
    pullRequestNumber: record.pullRequestNumber,
    repository: record.repository,
    source: record.source,
    status: record.status,
    updatedAt: record.updatedAt,
  };

  if (record.reviewId !== undefined) {
    normalized.reviewId = record.reviewId;
  }

  if (record.path !== undefined) {
    normalized.path = record.path;
  }

  if (record.line !== undefined) {
    normalized.line = record.line;
  }

  return normalized;
}
