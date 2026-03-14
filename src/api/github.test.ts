import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import type { GitHubIssueComment, GitHubReview, GitHubReviewComment } from "./github";

import {
  fetchIssueComments,
  fetchPullRequestComments,
  fetchPullRequestHeadSha,
  fetchPullRequestReviews,
} from "./github";

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = mock(handler) as typeof globalThis.fetch;
}

function jsonResponse(
  body: unknown,
  options: { headers?: Record<string, string>; status?: number } = {},
) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...options.headers },
    status: options.status ?? 200,
  });
}

const token = "ghp_test_token_123";
const owner = "sankenbisha";
const repo = "yamabiko-lite";
const prNumber = 42;

const sampleReview: GitHubReview = {
  body: "Looks good overall, minor nit.",
  commit_id: "abc123",
  html_url: "https://github.com/sankenbisha/yamabiko-lite/pull/42#pullrequestreview-1001",
  id: 1001,
  state: "commented",
  submitted_at: "2025-01-15T10:00:00Z",
  user: { id: 100, login: "coderabbitai[bot]", type: "Bot" },
};

const sampleReviewComment: GitHubReviewComment = {
  body: "This branch can be simplified.",
  commit_id: "abc123",
  html_url: "https://github.com/sankenbisha/yamabiko-lite/pull/42#discussion_r2001",
  id: 2001,
  line: 42,
  path: "src/cli/main.ts",
  pull_request_review_id: 1001,
  user: { id: 100, login: "coderabbitai[bot]", type: "Bot" },
};

const sampleIssueComment: GitHubIssueComment = {
  body: "General note: add test coverage.",
  html_url: "https://github.com/sankenbisha/yamabiko-lite/pull/42#issuecomment-3001",
  id: 3001,
  user: { id: 100, login: "coderabbitai[bot]", type: "Bot" },
};

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchPullRequestReviews", () => {
  it("returns parsed review array on success", async () => {
    mockFetch(async () => jsonResponse([sampleReview]));

    const reviews = await fetchPullRequestReviews(owner, repo, prNumber, token);

    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.id).toBe(1001);
    expect(reviews[0]!.state).toBe("commented");
    expect(reviews[0]!.body).toBe("Looks good overall, minor nit.");
  });

  it("sends correct authorization and accept headers", async () => {
    let capturedInit: RequestInit | undefined;
    mockFetch(async (_url, init) => {
      capturedInit = init;
      return jsonResponse([]);
    });

    await fetchPullRequestReviews(owner, repo, prNumber, token);

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${token}`);
    expect(headers["Accept"]).toBe("application/vnd.github+json");
  });
});

describe("fetchPullRequestComments", () => {
  it("returns parsed review comment array on success", async () => {
    mockFetch(async () => jsonResponse([sampleReviewComment]));

    const comments = await fetchPullRequestComments(owner, repo, prNumber, token);

    expect(comments).toHaveLength(1);
    expect(comments[0]!.id).toBe(2001);
    expect(comments[0]!.path).toBe("src/cli/main.ts");
    expect(comments[0]!.line).toBe(42);
  });
});

describe("fetchIssueComments", () => {
  it("returns parsed issue comment array on success", async () => {
    mockFetch(async () => jsonResponse([sampleIssueComment]));

    const comments = await fetchIssueComments(owner, repo, prNumber, token);

    expect(comments).toHaveLength(1);
    expect(comments[0]!.id).toBe(3001);
    expect(comments[0]!.body).toBe("General note: add test coverage.");
  });
});

describe("fetchPullRequestHeadSha", () => {
  it("returns head SHA string from PR response", async () => {
    mockFetch(async () =>
      jsonResponse({
        head: { ref: "feature-branch", sha: "deadbeef1234567890abcdef1234567890abcdef" },
        number: 42,
      }),
    );

    const sha = await fetchPullRequestHeadSha(owner, repo, prNumber, token);

    expect(sha).toBe("deadbeef1234567890abcdef1234567890abcdef");
  });
});

describe("error handling", () => {
  it("throws 'PR not found' on 404 response", async () => {
    mockFetch(async () => jsonResponse({ message: "Not Found" }, { status: 404 }));

    await expect(fetchPullRequestReviews(owner, repo, prNumber, token)).rejects.toThrow(
      "PR not found",
    );
  });

  it("throws rate limit message on 403 response", async () => {
    mockFetch(async () => jsonResponse({ message: "API rate limit exceeded" }, { status: 403 }));

    await expect(fetchPullRequestReviews(owner, repo, prNumber, token)).rejects.toThrow(
      "Rate limit exceeded",
    );
  });
});

describe("pagination", () => {
  it("follows Link header to fetch all pages", async () => {
    const page1 = [{ ...sampleReview, id: 1 }];
    const page2 = [{ ...sampleReview, id: 2 }];
    let callCount = 0;

    mockFetch(async (url) => {
      callCount++;
      if (callCount === 1) {
        return jsonResponse(page1, {
          headers: {
            Link: `<https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews?page=2>; rel="next"`,
          },
        });
      }
      return jsonResponse(page2);
    });

    const reviews = await fetchPullRequestReviews(owner, repo, prNumber, token);

    expect(reviews).toHaveLength(2);
    expect(reviews[0]!.id).toBe(1);
    expect(reviews[1]!.id).toBe(2);
    expect(callCount).toBe(2);
  });
});
