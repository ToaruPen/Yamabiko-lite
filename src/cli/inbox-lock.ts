import { mkdir, open, readFile, rm } from "node:fs/promises";
import { hostname as getHostname } from "node:os";
import path from "node:path";

interface InboxLockDeps {
  getGitCommonDirectory?: () => Promise<string>;
  getHostname?: () => string;
  getPid?: () => number;
  isProcessAlive?: (pid: number) => boolean;
  logWarning?: (message: string) => void;
}

interface InboxMutationTarget {
  branch: string;
  owner: string;
  prNumber: number;
  repo: string;
}

interface LockMetadata {
  hostname: string;
  pid: number;
  token: string;
}

const LOCK_ACQUIRE_ATTEMPTS = 3;

export async function withInboxMutationLock<T>(
  target: InboxMutationTarget,
  operation: () => Promise<T>,
  deps: InboxLockDeps = {},
): Promise<T> {
  const gitCommonDirectory = await (deps.getGitCommonDirectory ?? getGitCommonDirectory)();
  const currentHostname = (deps.getHostname ?? getHostname)();
  const currentPid = (deps.getPid ?? ((): number => process.pid))();
  const isProcessAlive = deps.isProcessAlive ?? defaultIsProcessAlive;
  const logWarning =
    deps.logWarning ??
    ((message: string): void => {
      console.error(message);
    });
  const lockDirectory = path.join(gitCommonDirectory, "yamabiko-lite", "locks");
  const lockPath = path.join(lockDirectory, buildLockFileName(target));
  const metadata: LockMetadata = {
    hostname: currentHostname,
    pid: currentPid,
    token: crypto.randomUUID(),
  };

  await mkdir(lockDirectory, { recursive: true });

  const lockHandle = await acquireInboxMutationLock(lockPath, metadata, target, isProcessAlive);

  let operationError: unknown;

  try {
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    await releaseInboxMutationLock(lockHandle, lockPath, metadata, logWarning, operationError);
  }
}

async function acquireInboxMutationLock(
  lockPath: string,
  metadata: LockMetadata,
  target: InboxMutationTarget,
  isProcessAlive: (pid: number) => boolean,
): Promise<Awaited<ReturnType<typeof open>>> {
  for (let attempt = 0; attempt < LOCK_ACQUIRE_ATTEMPTS; attempt++) {
    try {
      const lockHandle = await open(lockPath, "wx");
      await lockHandle.writeFile(JSON.stringify(metadata));
      return lockHandle;
    } catch (error) {
      if (!isLockAlreadyHeldError(error)) {
        throw error;
      }

      const recoveryOutcome = await recoverInboxMutationLock(lockPath, metadata, isProcessAlive);
      if (recoveryOutcome === "retry") {
        continue;
      }
    }
  }

  throw new Error(buildLockErrorMessage(target));
}

function buildLockCleanupWarning(
  phase: "close" | "remove",
  cleanupError: unknown,
  operationError: unknown,
): string {
  const cleanupMessage =
    cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
  const suffix = operationError === undefined ? "" : " (original operation error preserved)";
  return `Warning: inbox lock ${phase} cleanup failed: ${cleanupMessage}${suffix}`;
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

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
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

async function readLockMetadata(lockPath: string): Promise<LockMetadata | undefined> {
  try {
    const content = await readFile(lockPath, "utf8");
    const parsed = JSON.parse(content) as Partial<LockMetadata>;
    if (
      typeof parsed.hostname !== "string" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.token !== "string"
    ) {
      return undefined;
    }

    return {
      hostname: parsed.hostname,
      pid: parsed.pid,
      token: parsed.token,
    };
  } catch {
    return undefined;
  }
}

async function recoverInboxMutationLock(
  lockPath: string,
  metadata: LockMetadata,
  isProcessAlive: (pid: number) => boolean,
): Promise<"held" | "retry"> {
  const existingMetadata = await readLockMetadata(lockPath);
  if (existingMetadata === undefined) {
    return (await removeLockFileIfPresent(lockPath)) ? "retry" : "retry";
  }

  if (existingMetadata.hostname !== metadata.hostname) {
    return "held";
  }

  if (isProcessAlive(existingMetadata.pid)) {
    return "held";
  }

  await rm(lockPath, { force: true });
  return "retry";
}

async function releaseInboxMutationLock(
  lockHandle: Awaited<ReturnType<typeof open>>,
  lockPath: string,
  metadata: LockMetadata,
  logWarning: (message: string) => void,
  operationError: unknown,
): Promise<void> {
  try {
    await lockHandle.close();
  } catch (error) {
    logWarning(buildLockCleanupWarning("close", error, operationError));
  }

  try {
    const currentMetadata = await readLockMetadata(lockPath);
    if (currentMetadata?.token === metadata.token) {
      await rm(lockPath, { force: true });
    }
  } catch (error) {
    logWarning(buildLockCleanupWarning("remove", error, operationError));
  }
}

async function removeLockFileIfPresent(lockPath: string): Promise<boolean> {
  try {
    await rm(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
}
