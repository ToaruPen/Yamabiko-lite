// Stub — implementation pending (TDD red phase)

export interface GitHubReview {
  body: null | string;
  commit_id: string;
  html_url: string;
  id: number;
  state: "approved" | "changes_requested" | "commented" | "dismissed";
  submitted_at: null | string;
  user: { id: number; login: string; type: string };
}

export interface GitHubReviewComment {
  body: string;
  commit_id: string;
  html_url: string;
  id: number;
  in_reply_to_id?: number;
  line: null | number;
  path: string;
  pull_request_review_id: number;
  user: { id: number; login: string; type: string };
}

export interface GitHubIssueComment {
  body: string;
  html_url: string;
  id: number;
  user: { id: number; login: string; type: string };
}

export async function fetchPullRequestReviews(
  _owner: string,
  _repo: string,
  _prNumber: number,
  _token: string,
): Promise<GitHubReview[]> {
  throw new Error("Not implemented");
}

export async function fetchPullRequestComments(
  _owner: string,
  _repo: string,
  _prNumber: number,
  _token: string,
): Promise<GitHubReviewComment[]> {
  throw new Error("Not implemented");
}

export async function fetchIssueComments(
  _owner: string,
  _repo: string,
  _prNumber: number,
  _token: string,
): Promise<GitHubIssueComment[]> {
  throw new Error("Not implemented");
}

export async function fetchPullRequestHeadSha(
  _owner: string,
  _repo: string,
  _prNumber: number,
  _token: string,
): Promise<string> {
  throw new Error("Not implemented");
}
