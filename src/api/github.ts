const GITHUB_API_BASE = "https://api.github.com";

export interface GitHubIssueComment {
  body: string;
  html_url: string;
  id: number;
  user: { id: number; login: string; type: string };
}

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

interface PullRequestResponse {
  head: { ref: string; sha: string };
  number: number;
}

export async function fetchIssueComments(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<GitHubIssueComment[]> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${prNumber.toString()}/comments`;
  return fetchAllPages<GitHubIssueComment>(url, token);
}

export async function fetchPullRequestComments(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<GitHubReviewComment[]> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber.toString()}/comments`;
  return fetchAllPages<GitHubReviewComment>(url, token);
}

export async function fetchPullRequestHeadSha(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<string> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber.toString()}`;
  const response = await fetch(url, {
    headers: buildHeaders(token),
    method: "GET",
  });

  if (!response.ok) {
    handleErrorResponse(response);
  }

  const data = (await response.json()) as PullRequestResponse;
  return data.head.sha;
}

export async function fetchPullRequestReviews(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<GitHubReview[]> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber.toString()}/reviews`;
  return fetchAllPages<GitHubReview>(url, token);
}

function buildHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
  };
}

async function fetchAllPages<T>(url: string, token: string): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | undefined = url;

  while (nextUrl) {
    const response: Response = await fetch(nextUrl, {
      headers: buildHeaders(token),
      method: "GET",
    });

    if (!response.ok) {
      handleErrorResponse(response);
    }

    const data = (await response.json()) as T[];
    results.push(...data);

    const linkHeader: null | string = response.headers.get("Link");
    nextUrl = linkHeader ? parseNextUrl(linkHeader) : undefined;
  }

  return results;
}

function handleErrorResponse(response: Response): never {
  if (response.status === 404) {
    throw new Error("PR not found");
  }
  if (response.status === 403) {
    throw new Error("Rate limit exceeded");
  }
  throw new Error(`GitHub API error: ${response.status.toString()}`);
}

function parseNextUrl(linkHeader: string): string | undefined {
  const matches = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
  return matches?.[1];
}
