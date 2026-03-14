import type { PathLike } from "node:fs";

import { mkdir, open, readFile, rm } from "node:fs/promises";
import { hostname as getHostname } from "node:os";
import path from "node:path";

interface InboxLockDeps {
  getGitCommonDirectory?: () => Promise<string>;
  getHostname?: () => string;
  getPid?: () => number;
  isProcessAlive?: (pid: number) => boolean;
  logWarning?: (message: string) => void;
  openLockFile?: (path: PathLike, flags?: number | string) => Promise<LockHandle>;
  readLockFile?: typeof readFile;
  removeLockFile?: typeof rm;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface InboxMutationTarget {
  branch: string;
  owner: string;
  prNumber: number;
  repo: string;
}

interface LockHandle {
  close: () => Promise<void>;
  writeFile: (data: string) => Promise<unknown>;
}

interface LockMetadata {
  hostname: string;
  pid: number;
  token: string;
}

interface ResolvedInboxLockDeps {
  getGitCommonDirectory: () => Promise<string>;
  getHostname: () => string;
  getPid: () => number;
  isProcessAlive: (pid: number) => boolean;
  logWarning: (message: string) => void;
  openLockFile: (path: PathLike, flags?: number | string) => Promise<LockHandle>;
  readLockFile: typeof readFile;
  removeLockFile: typeof rm;
  sleep: (milliseconds: number) => Promise<void>;
}

const LOCK_ACQUIRE_ATTEMPTS = 3;
const LOCK_RETRY_DELAY_MS = 10;

export async function withInboxMutationLock<T>(
  target: InboxMutationTarget,
  operation: () => Promise<T>,
  deps: InboxLockDeps = {},
): Promise<T> {
  const resolvedDeps = resolveInboxLockDeps(deps);
  const gitCommonDirectory = await resolvedDeps.getGitCommonDirectory();
  const lockDirectory = path.join(gitCommonDirectory, "yamabiko-lite", "locks");
  const lockPath = path.join(lockDirectory, buildLockFileName(target));
  const metadata: LockMetadata = {
    hostname: resolvedDeps.getHostname(),
    pid: resolvedDeps.getPid(),
    token: crypto.randomUUID(),
  };

  await mkdir(lockDirectory, { recursive: true });

  const lockHandle = await acquireInboxMutationLock(
    lockPath,
    metadata,
    target,
    resolvedDeps.isProcessAlive,
    resolvedDeps.openLockFile,
    resolvedDeps.readLockFile,
    resolvedDeps.removeLockFile,
    resolvedDeps.sleep,
  );

  let operationError: unknown;

  try {
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    await releaseInboxMutationLock(
      lockHandle,
      lockPath,
      metadata,
      resolvedDeps.logWarning,
      operationError,
      resolvedDeps.readLockFile,
      resolvedDeps.removeLockFile,
    );
  }
}

async function acquireInboxMutationLock(
  lockPath: string,
  metadata: LockMetadata,
  target: InboxMutationTarget,
  isProcessAlive: (pid: number) => boolean,
  openLockFile: (path: PathLike, flags?: number | string) => Promise<LockHandle>,
  readLockFile: typeof readFile,
  removeLockFile: typeof rm,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<LockHandle> {
  for (let attempt = 0; attempt < LOCK_ACQUIRE_ATTEMPTS; attempt++) {
    let lockHandle: LockHandle | undefined;
    try {
      lockHandle = await openLockFile(lockPath, "wx");
      await lockHandle.writeFile(JSON.stringify(metadata));
      return lockHandle;
    } catch (error) {
      if (lockHandle) {
        await closeLockHandleSafely(lockHandle);
        await removeLockFileIfPresent(lockPath, removeLockFile);
      }

      if (!isLockAlreadyHeldError(error)) {
        throw error;
      }

      const recoveryOutcome = await recoverInboxMutationLock(
        lockPath,
        metadata,
        isProcessAlive,
        openLockFile,
        readLockFile,
        removeLockFile,
      );
      if (recoveryOutcome === "retry") {
        continue;
      }

      await sleep(LOCK_RETRY_DELAY_MS);
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

async function closeLockHandleSafely(lockHandle: LockHandle | undefined): Promise<void> {
  if (!lockHandle) {
    return;
  }

  try {
    await lockHandle.close();
  } catch {}
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await Bun.sleep(milliseconds);
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

async function readLockMetadata(
  lockPath: string,
  readLockFile: typeof readFile,
): Promise<LockMetadata | undefined> {
  try {
    const content = await readLockFile(lockPath, "utf8");
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
  openLockFile: (path: PathLike, flags?: number | string) => Promise<LockHandle>,
  readLockFile: typeof readFile,
  removeLockFile: typeof rm,
): Promise<"held" | "retry"> {
  const recoveryLockPath = `${lockPath}.recover`;
  let recoveryHandle: LockHandle | undefined;

  try {
    recoveryHandle = await openLockFile(recoveryLockPath, "wx");
  } catch (error) {
    if (isLockAlreadyHeldError(error)) {
      return "held";
    }

    throw error;
  }

  try {
    const existingMetadata = await readLockMetadata(lockPath, readLockFile);
    if (existingMetadata === undefined) {
      return "held";
    }

    if (existingMetadata.hostname !== metadata.hostname) {
      return "held";
    }

    if (isProcessAlive(existingMetadata.pid)) {
      return "held";
    }

    await removeLockFile(lockPath, { force: true });
    return "retry";
  } finally {
    await closeLockHandleSafely(recoveryHandle);
    await removeLockFileIfPresent(recoveryLockPath, removeLockFile);
  }
}

async function releaseInboxMutationLock(
  lockHandle: LockHandle,
  lockPath: string,
  metadata: LockMetadata,
  logWarning: (message: string) => void,
  operationError: unknown,
  readLockFile: typeof readFile,
  removeLockFile: typeof rm,
): Promise<void> {
  try {
    await lockHandle.close();
  } catch (error) {
    logWarning(buildLockCleanupWarning("close", error, operationError));
  }

  try {
    const currentMetadata = await readLockMetadata(lockPath, readLockFile);
    if (currentMetadata?.token === metadata.token) {
      await removeLockFile(lockPath, { force: true });
    }
  } catch (error) {
    logWarning(buildLockCleanupWarning("remove", error, operationError));
  }
}

async function removeLockFileIfPresent(lockPath: string, removeLockFile: typeof rm): Promise<void> {
  try {
    await removeLockFile(lockPath, { force: true });
  } catch {}
}

function resolveInboxLockDeps(deps: InboxLockDeps): ResolvedInboxLockDeps {
  return {
    getGitCommonDirectory: deps.getGitCommonDirectory ?? getGitCommonDirectory,
    getHostname: deps.getHostname ?? getHostname,
    getPid: deps.getPid ?? ((): number => process.pid),
    isProcessAlive: deps.isProcessAlive ?? defaultIsProcessAlive,
    logWarning:
      deps.logWarning ??
      ((message: string): void => {
        console.error(message);
      }),
    openLockFile: deps.openLockFile ?? open,
    readLockFile: deps.readLockFile ?? readFile,
    removeLockFile: deps.removeLockFile ?? rm,
    sleep: deps.sleep ?? defaultSleep,
  };
}
