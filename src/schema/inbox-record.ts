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

import type { InboxStatus } from "./state.ts";

import { INBOX_STATUSES } from "./state.ts";

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
  status: InboxStatus;
  updatedAt: string;
}

const EventTypeSchema = union([
  literal("pull_request_review"),
  literal("pull_request_review_comment"),
  literal("issue_comment"),
]);

const statusLiterals = INBOX_STATUSES.map((status) => literal(status));
const [firstStatusLiteral, ...remainingStatusLiterals] = statusLiterals;

if (firstStatusLiteral === undefined) {
  throw new Error("INBOX_STATUSES must contain at least one status");
}

const StatusSchema = union([firstStatusLiteral, ...remainingStatusLiterals]);

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

export function parseInboxRecords(
  jsonlContent: string,
  onWarning?: (line: number, message: string) => void,
): InboxRecord[] {
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
      if (onWarning) {
        onWarning(index + 1, message);
      } else {
        console.warn(`[inbox-record] Skipping invalid JSONL line ${String(index + 1)}: ${message}`);
      }
      continue;
    }

    const result = safeParse(InboxRecordSchema, parsedJson);

    if (result.success) {
      records.push(normalizeOptionalFields(result.output));
      continue;
    }

    const issues = result.issues
      .map((issue) => {
        const pathString = issue.path
          ?.map((segment) => {
            if (typeof segment.key === "string") return segment.key;
            if (typeof segment.key === "number") return `[${segment.key.toString()}]`;
            return segment.type;
          })
          .join(".");
        if (pathString) {
          return `${pathString}: ${issue.message}`;
        }
        return issue.message || JSON.stringify(issue);
      })
      .join("; ");

    if (onWarning) {
      onWarning(index + 1, issues);
    } else {
      console.warn(`[inbox-record] Skipping invalid record on line ${String(index + 1)}: ${issues}`);
    }
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
