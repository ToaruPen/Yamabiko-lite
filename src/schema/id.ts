export function extractDeduplicationKey(record: {
  commentId: number;
  eventType: string;
  reviewId?: number;
}): number {
  if (record.eventType === "pull_request_review") {
    if (
      record.reviewId === undefined ||
      !Number.isInteger(record.reviewId) ||
      record.reviewId <= 0
    ) {
      throw new Error(`reviewId must be a positive integer for pull_request_review events`);
    }
    return record.reviewId;
  }

  if (record.eventType === "pull_request_review_comment" || record.eventType === "issue_comment") {
    if (!Number.isInteger(record.commentId) || record.commentId <= 0) {
      throw new Error(`commentId is required for ${record.eventType} events`);
    }
    return record.commentId;
  }

  throw new Error(`Unknown event type: ${record.eventType}`);
}

export function generateRecordId(source: string, eventType: string, sourceId: number): string {
  return `${source}-${eventType}-${String(sourceId)}`;
}
