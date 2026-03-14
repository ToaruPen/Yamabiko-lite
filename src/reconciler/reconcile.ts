import type { GitHubIssueComment, GitHubReview, GitHubReviewComment } from "../api/github.ts";
import type { GitHubUser } from "../normalizer/types.ts";
import type { InboxRecord } from "../schema/inbox-record.ts";

import {
  fetchIssueComments,
  fetchPullRequestComments,
  fetchPullRequestReviews,
} from "../api/github.ts";
import { isAllowedBot } from "../normalizer/bot-filter.ts";
import {
  normalizeIssueCommentEvent,
  normalizeReviewCommentEvent,
  normalizeReviewEvent,
} from "../normalizer/normalize.ts";
import { upsertRecords } from "../storage/upsert.ts";

interface ReconcileOptions {
  allowlist: readonly string[];
  existingRecords: readonly InboxRecord[];
  headSha: string;
  owner: string;
  prNumber: number;
  repo: string;
  token: string;
}

interface ReconcileResult {
  added: number;
  records: InboxRecord[];
  unchanged: number;
  updated: number;
}

export async function reconcilePullRequest(options: ReconcileOptions): Promise<ReconcileResult> {
  const reviews = await withRetry(() =>
    fetchPullRequestReviews(options.owner, options.repo, options.prNumber, options.token),
  );
  const reviewComments = await withRetry(() =>
    fetchPullRequestComments(options.owner, options.repo, options.prNumber, options.token),
  );
  const issueComments = await withRetry(() =>
    fetchIssueComments(options.owner, options.repo, options.prNumber, options.token),
  );

  const incoming = [
    ...normalizeReviews(reviews, options),
    ...normalizeReviewComments(reviewComments, options),
    ...normalizeIssueComments(issueComments, options),
  ];
  const records = upsertRecords(options.existingRecords, incoming);
  const { added, unchanged, updated } = countChanges(options.existingRecords, records);

  return { added, records, unchanged, updated };
}

function countChanges(
  existingRecords: readonly InboxRecord[],
  records: readonly InboxRecord[],
): Pick<ReconcileResult, "added" | "unchanged" | "updated"> {
  const existingById = new Map(existingRecords.map((record) => [record.id, record]));
  let added = 0;
  let updated = 0;

  for (const record of records) {
    const existing = existingById.get(record.id);
    if (existing === undefined) {
      added += 1;
      continue;
    }
    if (
      existing.body !== record.body ||
      existing.headSha !== record.headSha ||
      existing.updatedAt !== record.updatedAt
    ) {
      updated += 1;
    }
  }

  return { added, unchanged: existingRecords.length - updated, updated };
}

function isTransientError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return error instanceof Error && /GitHub API error:\s*5\d\d/.test(error.message);
}

function normalizeIssueComments(
  items: readonly GitHubIssueComment[],
  options: ReconcileOptions,
): InboxRecord[] {
  const normalized: InboxRecord[] = [];
  const prUrl = `https://github.com/${options.owner}/${options.repo}/pull/${options.prNumber.toString()}`;
  for (const comment of items) {
    const user = toGitHubUser(comment.user);
    if (!isAllowedBot(user, options.allowlist)) continue;
    const record = normalizeIssueCommentEvent(
      {
        action: "created",
        comment: { ...comment, user },
        issue: {
          number: options.prNumber,
          pull_request: { html_url: prUrl, url: prUrl },
          state: "open",
        },
        repository: { name: options.repo, owner: { login: options.owner } },
      },
      options.headSha,
    );
    if (record !== null) normalized.push(record);
  }
  return normalized;
}

function normalizeReviewComments(
  items: readonly GitHubReviewComment[],
  options: ReconcileOptions,
): InboxRecord[] {
  const normalized: InboxRecord[] = [];
  for (const comment of items) {
    const user = toGitHubUser(comment.user);
    if (!isAllowedBot(user, options.allowlist)) continue;
    const record = normalizeReviewCommentEvent({
      action: "created",
      comment: { ...comment, user },
      pull_request: {
        head: { ref: "", sha: options.headSha },
        number: options.prNumber,
        state: "open",
      },
      repository: { name: options.repo, owner: { login: options.owner } },
    });
    if (record !== null) normalized.push(record);
  }
  return normalized;
}

function normalizeReviews(
  items: readonly GitHubReview[],
  options: ReconcileOptions,
): InboxRecord[] {
  const normalized: InboxRecord[] = [];
  for (const review of items) {
    const user = toGitHubUser(review.user);
    if (!isAllowedBot(user, options.allowlist)) continue;
    const record = normalizeReviewEvent({
      action: "submitted",
      pull_request: {
        head: { ref: "", sha: options.headSha },
        number: options.prNumber,
        state: "open",
      },
      repository: { name: options.repo, owner: { login: options.owner } },
      review: { ...review, user },
    });
    if (record !== null) normalized.push(record);
  }
  return normalized;
}

function toGitHubUser(user: { id: number; login: string; type: string }): GitHubUser {
  return {
    id: user.id,
    login: user.login,
    type:
      user.type === "Bot" || user.type === "Organization" || user.type === "User"
        ? user.type
        : "User",
  };
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === 3 || !isTransientError(error)) {
        throw error;
      }
      await Bun.sleep(1000);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown retry failure");
}
