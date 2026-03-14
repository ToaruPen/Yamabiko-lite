import { defineCommand } from "citty";
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
    await writeJsonlFile(worktreeJsonlPath, updatedRecords);

    const markdown = generateMarkdownSummary(updatedRecords, prNumber, {
      name,
      owner,
    });
    const worktreeMdPath = path.join(worktreePath, mdPath);
    await Bun.write(worktreeMdPath, markdown);

    await commitAndPushInbox(
      worktreePath,
      arguments_.branch,
      `resolve: ${arguments_.id} → ${resolveStatus}`,
    );

    return `Resolved: ${arguments_.id} (${oldStatus} → ${resolveStatus})`;
  } finally {
    await cleanupWorktree(worktreePath);
  }
}

function detectRepo(): string {
  throw new Error("Could not detect repository. Pass --repo owner/repo explicitly.");
}

function parsePrNumber(pr: string): number {
  const prNumber = Number(pr);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`Invalid PR number: ${pr}`);
  }

  return prNumber;
}

function parseRepo(repo: string): { name: string; owner: string } {
  const parts = repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo format: "${repo}". Expected "owner/repo".`);
  }
  return { name: parts[1], owner: parts[0] };
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
      description: "Repository in owner/repo format",
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
  async run({ args: commandArguments }) {
    const repo = commandArguments.repo || detectRepo();
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
