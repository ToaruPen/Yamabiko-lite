import { defineCommand } from "citty";

import type { InboxRecord } from "../../schema/inbox-record.ts";

import { readFileFromBranch } from "../../actions/branch.ts";
import { parseInboxRecords } from "../../schema/inbox-record.ts";
import { generateMarkdownSummary } from "../../storage/markdown.ts";

export interface ListOptions {
  branch: string;
  includeStale: boolean;
  json: boolean;
  pr: number;
  repo: string;
}

export async function listInboxItems(options: ListOptions): Promise<void> {
  const records = await readInboxFromBranch(options.branch, options.repo, options.pr);
  const headSha = await getCurrentHeadSha();

  const filtered = options.includeStale
    ? records
    : records.filter((r) => r.status !== "stale" && r.headSha === headSha);

  if (options.json) {
    console.log(JSON.stringify(filtered, undefined, 2));
    return;
  }

  if (filtered.length === 0) {
    console.log(`No pending inbox items for PR #${String(options.pr)}`);
    return;
  }

  const separatorIndex = options.repo.indexOf("/");
  const owner = options.repo.slice(0, separatorIndex);
  const name = options.repo.slice(separatorIndex + 1);
  console.log(generateMarkdownSummary(filtered, options.pr, { name, owner }));
}

export async function readInboxFromBranch(
  branch: string,
  repoPath: string,
  prNumber: number,
): Promise<InboxRecord[]> {
  const separatorIndex = repoPath.indexOf("/");
  const owner = repoPath.slice(0, separatorIndex);
  const name = repoPath.slice(separatorIndex + 1);
  const jsonlPath = `.yamabiko-lite/inbox/${owner}/${name}/pr-${String(prNumber)}.jsonl`;

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

    if (Number.isNaN(prNumber) || prNumber <= 0) {
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
  const stdout = await new Response(subprocess.stdout).text();
  await subprocess.exited;
  return stdout.trim();
}

async function inferRepoFromRemote(): Promise<string> {
  const subprocess = Bun.spawn(["git", "remote", "get-url", "origin"], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = await new Response(subprocess.stdout).text();
  await subprocess.exited;

  const url = stdout.trim();
  const match = /[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(url);

  if (!match?.[1] || !match[2]) {
    throw new Error(`Cannot parse repository from remote URL: ${url}`);
  }

  return `${match[1]}/${match[2]}`;
}
