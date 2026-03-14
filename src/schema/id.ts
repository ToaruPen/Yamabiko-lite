export function generateRecordId(
  source: string,
  eventType: string,
  sourceId: number,
): string {
  return `${source}-${eventType}-${sourceId}`;
}

export function extractDeduplicationKey(record: {
  commentId: number;
  reviewId?: number;
  eventType: string;
}): number {
  if (record.eventType === "pull_request_review") {
    if (record.reviewId === undefined) {
      throw new Error(
        `reviewId is required for pull_request_review events`,
      );
    }
    return record.reviewId;
  }

  if (
    record.eventType === "pull_request_review_comment" ||
    record.eventType === "issue_comment"
  ) {
    if (!record.commentId) {
      throw new Error(
        `commentId is required for ${record.eventType} events`,
      );
    }
    return record.commentId;
  }

  throw new Error(`Unknown event type: ${record.eventType}`);
}
