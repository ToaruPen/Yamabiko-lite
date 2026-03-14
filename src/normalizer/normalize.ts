import type { InboxRecord } from "../schema/inbox-record";
import { generateRecordId } from "../schema/id";
import type {
  IssueCommentEvent,
  PullRequestReviewCommentEvent,
  PullRequestReviewEvent,
} from "./types";

function normalizeBody(body: null | string): null | string {
  if (body === null) return null;
  return body.trim() === "" ? null : body;
}

function baseRecord(
  eventType: InboxRecord["eventType"],
  sourceId: number,
): {
  createdAt: string;
  id: string;
  source: "github";
  status: "pending";
  updatedAt: string;
} {
  const now = new Date().toISOString();
  return {
    createdAt: now,
    id: generateRecordId("github", eventType, sourceId),
    source: "github",
    status: "pending",
    updatedAt: now,
  };
}

export function normalizeReviewEvent(event: PullRequestReviewEvent): InboxRecord | null {
  const body = normalizeBody(event.review.body);
  if (body === null) return null;

  return {
    ...baseRecord("pull_request_review", event.review.id),
    body,
    botLogin: event.review.user.login,
    commentId: event.review.id,
    commentUrl: event.review.html_url,
    eventType: "pull_request_review",
    headSha: event.pull_request.head.sha,
    pullRequestNumber: event.pull_request.number,
    repository: { name: event.repository.name, owner: event.repository.owner.login },
    reviewId: event.review.id,
  };
}

export function normalizeReviewCommentEvent(
  event: PullRequestReviewCommentEvent,
): InboxRecord | null {
  const body = normalizeBody(event.comment.body);
  if (body === null) return null;

  const record: InboxRecord = {
    ...baseRecord("pull_request_review_comment", event.comment.id),
    body,
    botLogin: event.comment.user.login,
    commentId: event.comment.id,
    commentUrl: event.comment.html_url,
    eventType: "pull_request_review_comment",
    headSha: event.pull_request.head.sha,
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

export function normalizeIssueCommentEvent(
  event: IssueCommentEvent,
  headSha: string,
): InboxRecord | null {
  const body = normalizeBody(event.comment.body);
  if (body === null || event.issue.pull_request === undefined) return null;

  return {
    ...baseRecord("issue_comment", event.comment.id),
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

export function normalizeEvent(
  eventType: string,
  payload: unknown,
  headSha?: string,
): InboxRecord | null {
  switch (eventType) {
    case "pull_request_review":
      return normalizeReviewEvent(payload as PullRequestReviewEvent);
    case "pull_request_review_comment":
      return normalizeReviewCommentEvent(payload as PullRequestReviewCommentEvent);
    case "issue_comment":
      return headSha === undefined
        ? null
        : normalizeIssueCommentEvent(payload as IssueCommentEvent, headSha);
    default:
      return null;
  }
}
