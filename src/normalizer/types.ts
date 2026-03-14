export interface GitHubRepository {
  name: string;
  owner: { login: string };
}

// user.type is server-authoritative: GitHub API returns "Bot" with capital B
export interface GitHubUser {
  id: number;
  login: string;
  type: "Bot" | "Organization" | "User";
}

export interface IssueCommentEvent {
  action: "created" | "deleted" | "edited";
  comment: {
    body: string;
    created_at?: string;
    html_url: string;
    id: number;
    updated_at?: string;
    user: GitHubUser;
  };
  issue: {
    number: number;
    pull_request?: {
      html_url: string;
      url: string;
    };
    state: string;
  };
  repository: GitHubRepository;
}

export interface PullRequestReviewCommentEvent {
  action: "created" | "deleted" | "edited";
  comment: {
    body: string;
    commit_id: string;
    created_at?: string;
    html_url: string;
    id: number;
    in_reply_to_id?: number;
    line: null | number;
    path: string;
    pull_request_review_id: number;
    updated_at?: string;
    user: GitHubUser;
  };
  pull_request: {
    head: { ref: string; sha: string };
    number: number;
    state: string;
  };
  repository: GitHubRepository;
}

export interface PullRequestReviewEvent {
  action: "dismissed" | "edited" | "submitted";
  pull_request: {
    head: { ref: string; sha: string };
    number: number;
    state: string;
  };
  repository: GitHubRepository;
  review: {
    body: null | string;
    commit_id: string;
    html_url: string;
    id: number;
    state: "approved" | "changes_requested" | "commented" | "dismissed";
    submitted_at: null | string;
    user: GitHubUser;
  };
}
