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
  resolveInboxPathsInBranch,
} from "../../actions/branch.ts";
import { parseInboxRecords } from "../../schema/inbox-record.ts";
import { assertValidTransition } from "../../schema/state.ts";
import { validateJsonlIntegrity, writeJsonlFile } from "../../storage/jsonl.ts";
import { generateMarkdownSummary } from "../../storage/markdown.ts";
import { withInboxMutationLock } from "../inbox-lock.ts";
import { inferRepoFromRemote, parseRepo } from "../parse-repo.ts";

interface ClaimOptions {
  branch: string;
  id: string;
  pr: string;
  repo: string;
}

interface ClaimResult {
  message: string;
  previousStatus: InboxStatus;
  updatedRecords: InboxRecord[];
}

export function applyClaimToRecords(records: InboxRecord[], id: string): ClaimResult {
  const record = records.find((r) => r.id === id);
  if (!record) {
    throw new Error(`Item not found: ${id}`);
  }

  const previousStatus = record.status;
  assertValidTransition(record.status, "claimed");

  const updatedRecords = records.map((r) =>
    r.id === id ? { ...r, status: "claimed" as const, updatedAt: new Date().toISOString() } : r,
  );

  return {
    message: `Claimed: ${id} (${previousStatus} → claimed)`,
    previousStatus,
    updatedRecords,
  };
}

export async function runClaim(options: ClaimOptions): Promise<string> {
  const { branch, id, pr, repo } = options;
  const { name, owner } = parseRepo(repo);
  const prNumber = parsePrNumber(pr);

  return await withInboxMutationLock({ branch, owner, prNumber, repo: name }, async () => {
    const worktreePath = await ensureInboxBranch(branch);
    try {
      const { jsonlPath: jsonlRelativePath, mdPath: mdRelativePath } =
        await resolveInboxPathsInBranch(branch, owner, name, prNumber);
      const content = await readFileFromBranch(branch, jsonlRelativePath);
      const records = content ? parseInboxRecords(content) : [];

      validateJsonlIntegrity(content, records.length);

      const { message, updatedRecords } = applyClaimToRecords(records, id);

      const jsonlFullPath = path.join(worktreePath, jsonlRelativePath);
      const mdFullPath = path.join(worktreePath, mdRelativePath);

      await mkdir(path.dirname(jsonlFullPath), { recursive: true });
      await writeJsonlFile(jsonlFullPath, updatedRecords);

      const markdown = generateMarkdownSummary(updatedRecords, prNumber, { name, owner });
      await Bun.write(mdFullPath, markdown);

      await commitAndPushInbox(worktreePath, branch, `claim: ${id}`);

      console.log(message);
      return message;
    } finally {
      try {
        await cleanupWorktree(worktreePath);
      } catch (cleanupError: unknown) {
        const cleanupMessage =
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        console.error(`Warning: worktree cleanup failed: ${cleanupMessage}`);
      }
    }
  });
}

function parsePrNumber(pr: string): number {
  const prNumber = Number(pr);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`Invalid PR number: "${pr}". Expected a positive integer.`);
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
      description: "Record ID to claim",
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
  },
  meta: {
    description: "Claim an inbox item",
    name: "claim",
  },
  async run({ args }): Promise<void> {
    const repo = args.repo || (await inferRepoFromRemote());

    await runClaim({
      branch: args.branch,
      id: args.id,
      pr: args.pr,
      repo,
    });
  },
});
