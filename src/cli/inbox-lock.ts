import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

interface InboxLockDeps {
  getGitCommonDirectory?: () => Promise<string>;
}

interface InboxMutationTarget {
  branch: string;
  owner: string;
  prNumber: number;
  repo: string;
}

export async function withInboxMutationLock<T>(
  target: InboxMutationTarget,
  operation: () => Promise<T>,
  deps: InboxLockDeps = {},
): Promise<T> {
  const gitCommonDirectory = await (deps.getGitCommonDirectory ?? getGitCommonDirectory)();
  const lockDirectory = path.join(gitCommonDirectory, "yamabiko-lite", "locks");
  const lockPath = path.join(lockDirectory, buildLockFileName(target));

  await mkdir(lockDirectory, { recursive: true });

  let lockHandle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    lockHandle = await open(lockPath, "wx");
    return await operation();
  } catch (error) {
    if (isLockAlreadyHeldError(error)) {
      throw new Error(buildLockErrorMessage(target));
    }

    throw error;
  } finally {
    if (lockHandle) {
      await lockHandle.close();
      await rm(lockPath, { force: true });
    }
  }
}

function buildLockErrorMessage(target: InboxMutationTarget): string {
  return `Inbox mutation lock already held for ${target.owner}/${target.repo} PR #${String(target.prNumber)} on branch ${target.branch}.`;
}

function buildLockFileName(target: InboxMutationTarget): string {
  return [target.branch, target.owner, target.repo, `pr-${String(target.prNumber)}`]
    .map((segment) => encodeURIComponent(segment))
    .join("--")
    .concat(".lock");
}

async function getGitCommonDirectory(): Promise<string> {
  const subprocess = Bun.spawn(["git", "rev-parse", "--git-common-dir"], {
    env: { ...process.env, LC_ALL: "C" },
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
      `Failed to resolve git common dir: ${stderr.trim() || `exit code ${String(exitCode)}`}`,
    );
  }

  return path.resolve(stdout.trim());
}

function isLockAlreadyHeldError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
