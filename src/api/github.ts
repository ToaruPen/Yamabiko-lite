const GITHUB_API_BASE = "https://api.github.com";

export interface GitHubIssueComment {
  body: string;
  created_at: string;
  html_url: string;
  id: number;
  updated_at: string;
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
  created_at: string;
  html_url: string;
  id: number;
  in_reply_to_id?: number;
  line: null | number;
  path: string;
  pull_request_review_id: number;
  updated_at: string;
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
    await handleErrorResponse(response);
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
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function extractErrorMessage(response: Response): Promise<string | undefined> {
  const responseText = await response.text();
  const bodyText = responseText.trim();
  if (bodyText === "") {
    return undefined;
  }

  try {
    const parsedBody = JSON.parse(bodyText) as { message?: unknown };
    return typeof parsedBody.message === "string" ? parsedBody.message : bodyText;
  } catch {
    return bodyText;
  }
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
      await handleErrorResponse(response);
    }

    const data = (await response.json()) as T[];
    results.push(...data);

    const linkHeader: null | string = response.headers.get("Link");
    nextUrl = linkHeader ? parseNextUrl(linkHeader) : undefined;
  }

  return results;
}

async function handleErrorResponse(response: Response): Promise<never> {
  if (response.status === 404) {
    throw new Error("PR not found");
  }

  if (response.status === 403) {
    if (response.headers.get("X-RateLimit-Remaining") === "0") {
      throw new Error("Rate limit exceeded");
    }

    const message = (await extractErrorMessage(response)) ?? "Forbidden";
    throw new Error(`Access forbidden: ${message}`);
  }

  throw new Error(`GitHub API error: ${response.status.toString()}`);
}

function parseNextUrl(linkHeader: string): string | undefined {
  const matches = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
  return matches?.[1];
}
