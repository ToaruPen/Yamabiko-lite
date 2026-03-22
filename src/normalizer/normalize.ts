/* eslint-disable unicorn/no-null */
import * as v from "valibot";

import type { InboxRecord } from "../schema/inbox-record.ts";
import type {
  IssueCommentEvent,
  PullRequestReviewCommentEvent,
  PullRequestReviewEvent,
} from "./types.ts";

import { generateRecordId } from "../schema/id.ts";

export type TimeProvider = () => string;
const defaultTimeProvider: TimeProvider = (): string => new Date().toISOString();

const GitHubUserSchema = v.object({
  login: v.string(),
});

const RepositorySchema = v.object({
  name: v.string(),
  owner: v.object({
    login: v.string(),
  }),
});

const IssueCommentEventSchema = v.object({
  comment: v.object({
    body: v.string(),
    created_at: v.optional(v.string()),
    html_url: v.string(),
    id: v.number(),
    updated_at: v.optional(v.string()),
    user: GitHubUserSchema,
  }),
  issue: v.object({
    number: v.number(),
    pull_request: v.optional(v.object({})),
  }),
  repository: RepositorySchema,
});

const PullRequestReviewEventSchema = v.object({
  pull_request: v.object({
    head: v.object({
      sha: v.string(),
    }),
    number: v.number(),
  }),
  repository: RepositorySchema,
  review: v.object({
    body: v.nullable(v.string()),
    commit_id: v.string(),
    html_url: v.string(),
    id: v.number(),
    submitted_at: v.nullable(v.string()),
    user: GitHubUserSchema,
  }),
});

const PullRequestReviewCommentEventSchema = v.object({
  comment: v.object({
    body: v.string(),
    commit_id: v.string(),
    created_at: v.optional(v.string()),
    html_url: v.string(),
    id: v.number(),
    line: v.nullable(v.number()),
    path: v.string(),
    pull_request_review_id: v.number(),
    updated_at: v.optional(v.string()),
    user: GitHubUserSchema,
  }),
  pull_request: v.object({
    head: v.object({
      sha: v.string(),
    }),
    number: v.number(),
  }),
  repository: RepositorySchema,
});

export function normalizeEvent(
  eventType: string,
  payload: unknown,
  headSha?: string,
  now?: TimeProvider,
): InboxRecord | null {
  switch (eventType) {
    case "issue_comment": {
      if (headSha === undefined) {
        return null;
      }

      const result = v.safeParse(IssueCommentEventSchema, payload);

      if (!result.success) {
        return null;
      }

      return normalizeIssueCommentEvent(result.output as IssueCommentEvent, headSha, now);
    }
    case "pull_request_review": {
      const result = v.safeParse(PullRequestReviewEventSchema, payload);

      if (!result.success) {
        return null;
      }

      return normalizeReviewEvent(result.output as PullRequestReviewEvent, now);
    }
    case "pull_request_review_comment": {
      const result = v.safeParse(PullRequestReviewCommentEventSchema, payload);

      if (!result.success) {
        return null;
      }

      return normalizeReviewCommentEvent(result.output as PullRequestReviewCommentEvent, now);
    }
    default: {
      return null;
    }
  }
}

// issue_comment events don't include pull_request.head.sha in their payload,
// so headSha must be provided externally (from the reconciler or API lookup).
export function normalizeIssueCommentEvent(
  event: IssueCommentEvent,
  headSha: string,
  now?: TimeProvider,
): InboxRecord | null {
  const body = normalizeBody(event.comment.body);
  if (body === null || event.issue.pull_request === undefined) return null;
  const fallbackTimestamp = (now ?? defaultTimeProvider)();

  return {
    ...baseRecord(
      "issue_comment",
      event.comment.id,
      {
        createdAt: event.comment.created_at ?? fallbackTimestamp,
        updatedAt: event.comment.updated_at ?? fallbackTimestamp,
      },
      now,
    ),
    body,
    botLogin: event.comment.user.login,
    commentId: event.comment.id,
    commentUrl: event.comment.html_url,
    eventType: "issue_comment",
    headSha,
    pullRequestNumber: event.issue.number,
    repository: { name: event.repository.name, owner: event.repository.owner.login },
  };
}

export function normalizeReviewCommentEvent(
  event: PullRequestReviewCommentEvent,
  now?: TimeProvider,
): InboxRecord | null {
  const body = normalizeBody(event.comment.body);
  if (body === null) return null;
  const fallbackTimestamp = (now ?? defaultTimeProvider)();

  const record: InboxRecord = {
    ...baseRecord(
      "pull_request_review_comment",
      event.comment.id,
      {
        createdAt: event.comment.created_at ?? fallbackTimestamp,
        updatedAt: event.comment.updated_at ?? fallbackTimestamp,
      },
      now,
    ),
    body,
    botLogin: event.comment.user.login,
    commentId: event.comment.id,
    commentUrl: event.comment.html_url,
    eventType: "pull_request_review_comment",
    headSha: event.comment.commit_id || event.pull_request.head.sha,
    path: event.comment.path,
    pullRequestNumber: event.pull_request.number,
    repository: { name: event.repository.name, owner: event.repository.owner.login },
    reviewId: event.comment.pull_request_review_id,
  };

  if (event.comment.line !== null) {
    record.line = event.comment.line;
  }

  return record;
}

export function normalizeReviewEvent(
  event: PullRequestReviewEvent,
  now?: TimeProvider,
): InboxRecord | null {
  const body = normalizeBody(event.review.body);
  if (body === null) return null;
  const fallbackTimestamp = (now ?? defaultTimeProvider)();

  return {
    ...baseRecord(
      "pull_request_review",
      event.review.id,
      {
        createdAt: event.review.submitted_at ?? fallbackTimestamp,
        updatedAt: event.review.submitted_at ?? fallbackTimestamp,
      },
      now,
    ),
    body,
    botLogin: event.review.user.login,
    commentId: event.review.id,
    commentUrl: event.review.html_url,
    eventType: "pull_request_review",
    headSha: event.review.commit_id || event.pull_request.head.sha,
    pullRequestNumber: event.pull_request.number,
    repository: { name: event.repository.name, owner: event.repository.owner.login },
    reviewId: event.review.id,
  };
}

function baseRecord(
  eventType: InboxRecord["eventType"],
  sourceId: number,
  timestamps?: {
    createdAt?: null | string;
    updatedAt?: null | string;
  },
  now?: TimeProvider,
): {
  createdAt: string;
  id: string;
  source: "github";
  status: "pending";
  updatedAt: string;
} {
  const fallback = (now ?? defaultTimeProvider)();
  const createdAt = timestamps?.createdAt ?? fallback;
  const updatedAt = timestamps?.updatedAt ?? fallback;
  return {
    createdAt,
    id: generateRecordId("github", eventType, sourceId),
    source: "github",
    status: "pending",
    updatedAt,
  };
}

function normalizeBody(body: null | string): null | string {
  if (body === null) return null;
  return body.trim() === "" ? null : body;
}
