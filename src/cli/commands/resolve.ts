import { defineCommand } from "citty";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { InboxRecord } from "../../schema/inbox-record.ts";
import type { InboxStatus } from "../../schema/state.ts";

import {
  cleanupWorktree,
  commitAndPushInbox,
  ensureInboxBranch,
  readFileFromBranch,
} from "../../actions/branch.ts";
import { parseInboxRecords } from "../../schema/inbox-record.ts";
import { assertValidTransition } from "../../schema/state.ts";
import { writeJsonlFile } from "../../storage/jsonl.ts";
import { generateMarkdownSummary } from "../../storage/markdown.ts";
import { inferRepoFromRemote, parseRepo } from "../parse-repo.ts";

const VALID_RESOLVE_STATUSES: ReadonlySet<string> = new Set(["fixed", "skipped"]);

interface ResolveArguments {
  branch: string;
  id: string;
  pr: string;
  repo: string;
  status: string;
}

export async function runResolve(arguments_: ResolveArguments): Promise<string> {
  if (!VALID_RESOLVE_STATUSES.has(arguments_.status)) {
    throw new Error(
      `Invalid resolve status: "${arguments_.status}". Must be "fixed" or "skipped".`,
    );
  }

  const resolveStatus = arguments_.status as InboxStatus;
  const { name, owner } = parseRepo(arguments_.repo);
  const prNumber = parsePrNumber(arguments_.pr);
  const jsonlPath = `.yamabiko-lite/inbox/${owner}/${name}/pr-${String(prNumber)}.jsonl`;
  const mdPath = `.yamabiko-lite/inbox/${owner}/${name}/pr-${String(prNumber)}.md`;

  const worktreePath = await ensureInboxBranch(arguments_.branch);

  try {
    const content = await readFileFromBranch(arguments_.branch, jsonlPath);
    const records: InboxRecord[] = content ? parseInboxRecords(content) : [];

    const rawLineCount = content
      ? content
          .trim()
          .split("\n")
          .filter((line) => line.trim() !== "").length
      : 0;
    if (records.length < rawLineCount) {
      throw new Error(
        `JSONL integrity check failed: parsed ${String(records.length)} records but found ${String(rawLineCount)} non-empty lines. Aborting to prevent data loss.`,
      );
    }

    const recordIndex = records.findIndex((r) => r.id === arguments_.id);
    if (recordIndex === -1) {
      throw new Error(`Item not found: ${arguments_.id}`);
    }

    const record = records[recordIndex];
    if (!record) {
      throw new Error(`Item not found: ${arguments_.id}`);
    }

    const oldStatus = record.status;
    assertValidTransition(oldStatus, resolveStatus);

    const updatedRecord: InboxRecord = {
      ...record,
      status: resolveStatus,
      updatedAt: new Date().toISOString(),
    };
    const updatedRecords = [...records];
    updatedRecords[recordIndex] = updatedRecord;

    const worktreeJsonlPath = path.join(worktreePath, jsonlPath);
    await mkdir(path.dirname(worktreeJsonlPath), { recursive: true });
    await writeJsonlFile(worktreeJsonlPath, updatedRecords);

    const markdown = generateMarkdownSummary(updatedRecords, prNumber, {
      name,
      owner,
    });
    const worktreeMdPath = path.join(worktreePath, mdPath);
    await mkdir(path.dirname(worktreeMdPath), { recursive: true });
    await Bun.write(worktreeMdPath, markdown);

    await commitAndPushInbox(
      worktreePath,
      arguments_.branch,
      `resolve: ${arguments_.id} → ${resolveStatus}`,
    );

    return `Resolved: ${arguments_.id} (${oldStatus} → ${resolveStatus})`;
  } finally {
    try {
      await cleanupWorktree(worktreePath);
    } catch (cleanupError: unknown) {
      const cleanupMessage =
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      console.error(`Warning: worktree cleanup failed: ${cleanupMessage}`);
    }
  }
}

function parsePrNumber(pr: string): number {
  const prNumber = Number(pr);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`Invalid PR number: ${pr}`);
  }

  return prNumber;
}

export default defineCommand({
  args: {
    branch: {
      default: "yamabiko-lite-inbox",
      description: "Inbox branch name",
      type: "string",
    },
    id: {
      description: "Record ID to resolve",
      required: true,
      type: "positional",
    },
    pr: {
      description: "PR number",
      required: true,
      type: "string",
    },
    repo: {
      description: "Repository in owner/repo format (inferred from git remote if omitted)",
      type: "string",
    },
    status: {
      description: 'Resolution status: "fixed" or "skipped"',
      required: true,
      type: "string",
    },
  },
  meta: {
    description: "Resolve an inbox item",
    name: "resolve",
  },
  async run({ args: commandArguments }): Promise<void> {
    const repo = commandArguments.repo || (await inferRepoFromRemote());
    const message = await runResolve({
      branch: commandArguments.branch,
      id: commandArguments.id,
      pr: commandArguments.pr,
      repo,
      status: commandArguments.status,
    });
    console.log(message);
  },
});
