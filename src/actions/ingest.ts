import { mkdir } from "node:fs/promises";
import path from "node:path";

import { fetchPullRequestHeadSha as _fetchPullRequestHeadSha } from "../api/github.ts";
import { DEFAULT_BOT_ALLOWLIST, parseBotAllowlist } from "../normalizer/bot-filter.ts";
import { reconcilePullRequest as _reconcilePullRequest } from "../reconciler/reconcile.ts";
import { parseInboxRecords } from "../schema/inbox-record.ts";
import { writeJsonlFile as _writeJsonlFile } from "../storage/jsonl.ts";
import { generateMarkdownSummary as _generateMarkdownSummary } from "../storage/markdown.ts";
import {
  cleanupWorktree as _cleanupWorktree,
  commitAndPushInbox as _commitAndPushInbox,
  ensureInboxBranch as _ensureInboxBranch,
  readFileFromBranch as _readFileFromBranch,
} from "./branch.ts";

export interface IngestDeps {
  cleanupWorktree?: typeof _cleanupWorktree;
  commitAndPushInbox?: typeof _commitAndPushInbox;
  ensureInboxBranch?: typeof _ensureInboxBranch;
  fetchPullRequestHeadSha?: typeof _fetchPullRequestHeadSha;
  generateMarkdownSummary?: typeof _generateMarkdownSummary;
  readFileFromBranch?: typeof _readFileFromBranch;
  reconcilePullRequest?: typeof _reconcilePullRequest;
  writeJsonlFile?: typeof _writeJsonlFile;
}

export interface IngestOptions {
  allowlist: readonly string[];
  branchName: string;
  eventPayload: unknown;
  eventType: string;
  token: string;
}

export interface IngestResult {
  added: number;
  totalRecords: number;
  unchanged: number;
  updated: number;
}

interface IngestContext {
  owner: string;
  prNumber: number;
  repo: string;
  reviewHeadSha?: string;
}

type ResolvedIngestDeps = Required<IngestDeps>;

export async function ingest(options: IngestOptions, deps: IngestDeps = {}): Promise<IngestResult> {
  const {
    cleanupWorktree,
    commitAndPushInbox,
    ensureInboxBranch,
    fetchPullRequestHeadSha,
    generateMarkdownSummary,
    readFileFromBranch,
    reconcilePullRequest,
    writeJsonlFile,
  } = resolveIngestDeps(deps);

  const context = extractContext(options.eventType, options.eventPayload);
  if (context === undefined) return { added: 0, totalRecords: 0, unchanged: 0, updated: 0 };

  const jsonlPath = `.yamabiko-lite/inbox/${context.owner}/${context.repo}/pr-${String(context.prNumber)}.jsonl`;
  const mdPath = `.yamabiko-lite/inbox/${context.owner}/${context.repo}/pr-${String(context.prNumber)}.md`;
  const worktreePath = await ensureInboxBranch(options.branchName);

  try {
    const existingJsonl = await readFileFromBranch(options.branchName, jsonlPath);
    const existingRecords = existingJsonl ? parseInboxRecords(existingJsonl) : [];
    const headSha =
      context.reviewHeadSha ??
      (await fetchPullRequestHeadSha(context.owner, context.repo, context.prNumber, options.token));

    const reconciled = await reconcilePullRequest({
      allowlist: options.allowlist,
      existingRecords,
      headSha,
      owner: context.owner,
      prNumber: context.prNumber,
      repo: context.repo,
      token: options.token,
    });

    const worktreeJsonlPath = path.join(worktreePath, jsonlPath);
    await mkdir(path.dirname(worktreeJsonlPath), { recursive: true });
    await writeJsonlFile(worktreeJsonlPath, reconciled.records);

    const markdown = generateMarkdownSummary(reconciled.records, context.prNumber, {
      name: context.repo,
      owner: context.owner,
    });
    await Bun.write(path.join(worktreePath, mdPath), markdown);
    await commitAndPushInbox(
      worktreePath,
      options.branchName,
      `ingest: PR #${String(context.prNumber)}`,
    );

    return {
      added: reconciled.added,
      totalRecords: reconciled.records.length,
      unchanged: reconciled.unchanged,
      updated: reconciled.updated,
    };
  } finally {
    await cleanupWorktree(worktreePath);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

export async function main(): Promise<void> {
  const eventType = process.env["GITHUB_EVENT_NAME"];
  const eventPath = process.env["GITHUB_EVENT_PATH"];
  const token = process.env["GITHUB_TOKEN"];

  if (!eventType || !eventPath || !token) {
    throw new Error(
      "Missing required env vars: GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_TOKEN",
    );
  }

  const allowlist = parseBotAllowlist(
    process.env["BOT_ALLOWLIST"] ?? DEFAULT_BOT_ALLOWLIST.join(","),
  );
  const eventPayload = (await Bun.file(eventPath).json()) as unknown;
  const result = await ingest({
    allowlist,
    branchName: "yamabiko-lite-inbox",
    eventPayload,
    eventType,
    token,
  });

  console.log(JSON.stringify(result));
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  throw new TypeError("Invalid event payload: object expected");
}

function extractContext(eventType: string, eventPayload: unknown): IngestContext | undefined {
  const payload = asObject(eventPayload);
  const repository = asObject(payload["repository"]);
  const owner = asObject(repository["owner"])["login"];
  const repo = repository["name"];

  if (typeof owner !== "string" || typeof repo !== "string") {
    throw new TypeError("Invalid event payload: repository owner/name missing");
  }

  if (eventType === "issue_comment") {
    const issue = asObject(payload["issue"]);
    if (issue["pull_request"] === undefined) return undefined;
    return { owner, prNumber: toPullRequestNumber(issue["number"]), repo };
  }

  if (eventType === "pull_request_review" || eventType === "pull_request_review_comment") {
    const pullRequest = asObject(payload["pull_request"]);
    const head = asObject(pullRequest["head"]);
    const headSha = head["sha"];
    if (typeof headSha !== "string") {
      throw new TypeError("Invalid event payload: pull_request.head.sha missing");
    }
    return {
      owner,
      prNumber: toPullRequestNumber(pullRequest["number"]),
      repo,
      reviewHeadSha: headSha,
    };
  }

  throw new Error(`Unsupported event type: ${eventType}`);
}

function resolveIngestDeps(deps: IngestDeps): ResolvedIngestDeps {
  return {
    cleanupWorktree: deps.cleanupWorktree ?? _cleanupWorktree,
    commitAndPushInbox: deps.commitAndPushInbox ?? _commitAndPushInbox,
    ensureInboxBranch: deps.ensureInboxBranch ?? _ensureInboxBranch,
    fetchPullRequestHeadSha: deps.fetchPullRequestHeadSha ?? _fetchPullRequestHeadSha,
    generateMarkdownSummary: deps.generateMarkdownSummary ?? _generateMarkdownSummary,
    readFileFromBranch: deps.readFileFromBranch ?? _readFileFromBranch,
    reconcilePullRequest: deps.reconcilePullRequest ?? _reconcilePullRequest,
    writeJsonlFile: deps.writeJsonlFile ?? _writeJsonlFile,
  };
}

function toPullRequestNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("Invalid event payload: pull request number missing");
  }
  return value;
}
