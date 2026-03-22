import { defineCommand } from "citty";

import type { InboxRecord } from "../../schema/inbox-record.ts";

import {
  fetchInboxBranch,
  readFileFromBranch,
  resolveInboxPathsInBranch,
} from "../../actions/branch.ts";
import { parseInboxRecords } from "../../schema/inbox-record.ts";
import { generateMarkdownSummary } from "../../storage/markdown.ts";
import { inferRepoFromRemote, parseRepo } from "../parse-repo.ts";

interface ListOptions {
  branch: string;
  includeStale: boolean;
  json: boolean;
  pr: number;
  repo: string;
}

export async function listInboxItems(options: ListOptions): Promise<void> {
  const { name, owner } = parseRepo(options.repo);
  const records = await readInboxFromBranch(options.branch, options.repo, options.pr);

  let filtered: InboxRecord[];
  if (options.includeStale) {
    filtered = records;
  } else {
    const headSha = await getCurrentHeadSha();
    // Exclude stale-status records and records from older commits
    filtered = records.filter((r) => r.status !== "stale" && r.headSha === headSha);
  }

  if (options.json) {
    console.log(JSON.stringify(filtered, undefined, 2));
    return;
  }

  if (filtered.length === 0) {
    console.log(`No inbox items found for PR #${String(options.pr)}`);
    return;
  }

  console.log(generateMarkdownSummary(filtered, options.pr, { name, owner }));
}

export async function readInboxFromBranch(
  branch: string,
  repoPath: string,
  prNumber: number,
): Promise<InboxRecord[]> {
  const { name, owner } = parseRepo(repoPath);

  await fetchInboxBranch(branch);
  const { jsonlPath } = await resolveInboxPathsInBranch(branch, owner, name, prNumber);
  const content = await readFileFromBranch(branch, jsonlPath);

  if (!content) {
    return [];
  }

  return parseInboxRecords(content);
}

export default defineCommand({
  args: {
    branch: {
      default: "yamabiko-lite-inbox",
      description: "Inbox branch name",
      type: "string",
    },
    "include-stale": {
      default: false,
      description: "Include stale items (outdated head SHA or stale status)",
      type: "boolean",
    },
    json: {
      default: false,
      description: "Output as JSON",
      type: "boolean",
    },
    pr: {
      description: "Pull request number",
      required: true,
      type: "string",
    },
    repo: {
      description: "Repository in owner/repo format (inferred from git remote if omitted)",
      type: "string",
    },
  },
  meta: {
    description: "List inbox items",
    name: "list",
  },
  async run({ args }): Promise<void> {
    const repo = args.repo || (await inferRepoFromRemote());
    const prNumber = Number(args.pr);

    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      throw new Error(`Invalid PR number: ${args.pr}`);
    }

    await listInboxItems({
      branch: args.branch,
      includeStale: args["include-stale"],
      json: args.json,
      pr: prNumber,
      repo,
    });
  },
});

async function getCurrentHeadSha(): Promise<string> {
  const subprocess = Bun.spawn(["git", "rev-parse", "HEAD"], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stderr, stdout, exitCode] = await Promise.all([
    new Response(subprocess.stderr).text(),
    new Response(subprocess.stdout).text(),
    subprocess.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `Failed to get current HEAD SHA: ${stderr.trim() || `exit code ${String(exitCode)}`}`,
    );
  }

  return stdout.trim();
}
