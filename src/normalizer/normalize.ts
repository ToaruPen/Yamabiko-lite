/* eslint-disable unicorn/no-null */
import type { InboxRecord } from "../schema/inbox-record";
import type {
  IssueCommentEvent,
  PullRequestReviewCommentEvent,
  PullRequestReviewEvent,
} from "./types";

import { generateRecordId } from "../schema/id";

export function normalizeEvent(
  eventType: string,
  payload: unknown,
  headSha?: string,
): InboxRecord | null {
  switch (eventType) {
    case "issue_comment": {
      return headSha === undefined
        ? null
        : normalizeIssueCommentEvent(payload as IssueCommentEvent, headSha);
    }
    case "pull_request_review": {
      return normalizeReviewEvent(payload as PullRequestReviewEvent);
    }
    case "pull_request_review_comment": {
      return normalizeReviewCommentEvent(payload as PullRequestReviewCommentEvent);
    }
    default: {
      return null;
    }
  }
}

export function normalizeIssueCommentEvent(
  event: IssueCommentEvent,
  headSha: string,
): InboxRecord | null {
  const body = normalizeBody(event.comment.body);
  if (body === null || event.issue.pull_request === undefined) return null;
  const fallbackTimestamp = new Date().toISOString();

  return {
    ...baseRecord("issue_comment", event.comment.id, {
      createdAt: event.comment.created_at ?? fallbackTimestamp,
      updatedAt: event.comment.updated_at ?? fallbackTimestamp,
    }),
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
): InboxRecord | null {
  const body = normalizeBody(event.comment.body);
  if (body === null) return null;
  const fallbackTimestamp = new Date().toISOString();

  const record: InboxRecord = {
    ...baseRecord("pull_request_review_comment", event.comment.id, {
      createdAt: event.comment.created_at ?? fallbackTimestamp,
      updatedAt: event.comment.updated_at ?? fallbackTimestamp,
    }),
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

export function normalizeReviewEvent(event: PullRequestReviewEvent): InboxRecord | null {
  const body = normalizeBody(event.review.body);
  if (body === null) return null;
  const fallbackTimestamp = new Date().toISOString();

  return {
    ...baseRecord("pull_request_review", event.review.id, {
      createdAt: event.review.submitted_at ?? fallbackTimestamp,
      updatedAt: event.review.submitted_at ?? fallbackTimestamp,
    }),
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
): {
  createdAt: string;
  id: string;
  source: "github";
  status: "pending";
  updatedAt: string;
} {
  const now = new Date().toISOString();
  const createdAt = timestamps?.createdAt ?? now;
  const updatedAt = timestamps?.updatedAt ?? now;
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
