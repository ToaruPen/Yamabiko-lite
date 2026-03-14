import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { withInboxMutationLock } from "./inbox-lock.ts";

describe("withInboxMutationLock", () => {
  let rootDirectory: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(path.join(tmpdir(), "yamabiko-lock-test-"));
  });

  afterEach(async () => {
    await rm(rootDirectory, { force: true, recursive: true });
  });

  it("releases the lock after the mutation completes", async () => {
    const lockDirectory = path.join(rootDirectory, "yamabiko-lite", "locks");

    const result = await withInboxMutationLock(
      {
        branch: "yamabiko-lite-inbox",
        owner: "owner",
        prNumber: 1,
        repo: "repo",
      },
      async () => "ok",
      {
        getGitCommonDirectory: async () => rootDirectory,
      },
    );

    expect(result).toBe("ok");
    expect(await readdir(lockDirectory)).toEqual([]);
  });

  it("fails fast when the same inbox mutation lock is already held", async () => {
    let markFirstLockEntered!: () => void;
    let releaseFirstLock!: () => void;
    const firstLockEntered = new Promise<void>((resolve) => {
      markFirstLockEntered = resolve;
    });
    const firstLockReleased = new Promise<void>((resolve) => {
      releaseFirstLock = resolve;
    });

    const firstOperation = withInboxMutationLock(
      {
        branch: "yamabiko-lite-inbox",
        owner: "owner",
        prNumber: 1,
        repo: "repo",
      },
      async () => {
        markFirstLockEntered();
        await firstLockReleased;
      },
      {
        getGitCommonDirectory: async () => rootDirectory,
      },
    );

    await firstLockEntered;

    await expect(
      withInboxMutationLock(
        {
          branch: "yamabiko-lite-inbox",
          owner: "owner",
          prNumber: 1,
          repo: "repo",
        },
        async () => "second",
        {
          getGitCommonDirectory: async () => rootDirectory,
        },
      ),
    ).rejects.toThrow(
      "Inbox mutation lock already held for owner/repo PR #1 on branch yamabiko-lite-inbox.",
    );

    releaseFirstLock();
    await firstOperation;
  });

  it("does not misclassify operation EEXIST errors as lock contention", async () => {
    const operationError = new Error("operation already created file");
    Object.assign(operationError, { code: "EEXIST" });

    await expect(
      withInboxMutationLock(
        {
          branch: "yamabiko-lite-inbox",
          owner: "owner",
          prNumber: 1,
          repo: "repo",
        },
        async () => {
          throw operationError;
        },
        {
          getGitCommonDirectory: async () => rootDirectory,
          getHostname: () => "test-host",
          getPid: () => 123,
        },
      ),
    ).rejects.toBe(operationError);
  });

  it("cleans up partial lock files when metadata writing fails", async () => {
    const removedPaths: string[] = [];
    const writeError = new Error("write failed");
    const fakeHandle = {
      close: () => Promise.resolve(),
      writeFile: async () => {
        throw writeError;
      },
    };

    await expect(
      withInboxMutationLock(
        {
          branch: "yamabiko-lite-inbox",
          owner: "owner",
          prNumber: 1,
          repo: "repo",
        },
        async () => "ok",
        {
          getGitCommonDirectory: async () => rootDirectory,
          openLockFile: async () => fakeHandle,
          removeLockFile: async (filePath) => {
            removedPaths.push(filePath.toString());
          },
        },
      ),
    ).rejects.toBe(writeError);

    expect(removedPaths).toContain(
      path.join(
        rootDirectory,
        "yamabiko-lite",
        "locks",
        "yamabiko-lite-inbox--owner--repo--pr-1.lock",
      ),
    );
  });

  it("recovers stale lock files when the owning process is gone", async () => {
    const lockDirectory = path.join(rootDirectory, "yamabiko-lite", "locks");
    const staleLockPath = path.join(lockDirectory, "yamabiko-lite-inbox--owner--repo--pr-1.lock");

    await mkdir(lockDirectory, { recursive: true });
    await writeFile(
      staleLockPath,
      JSON.stringify({ hostname: "test-host", pid: 111, token: "stale-token" }),
    );

    const result = await withInboxMutationLock(
      {
        branch: "yamabiko-lite-inbox",
        owner: "owner",
        prNumber: 1,
        repo: "repo",
      },
      async () => "recovered",
      {
        getGitCommonDirectory: async () => rootDirectory,
        getHostname: () => "test-host",
        getPid: () => 123,
        isProcessAlive: (pid) => pid === 123,
      },
    );

    expect(result).toBe("recovered");
    expect(await readdir(lockDirectory)).toEqual([]);
  });

  it("keeps rejecting active lock files", async () => {
    const lockDirectory = path.join(rootDirectory, "yamabiko-lite", "locks");
    const freshLockPath = path.join(lockDirectory, "yamabiko-lite-inbox--owner--repo--pr-1.lock");

    await mkdir(lockDirectory, { recursive: true });
    await writeFile(
      freshLockPath,
      JSON.stringify({ hostname: "test-host", pid: 222, token: "fresh-token" }),
    );

    await expect(
      withInboxMutationLock(
        {
          branch: "yamabiko-lite-inbox",
          owner: "owner",
          prNumber: 1,
          repo: "repo",
        },
        async () => "recovered",
        {
          getGitCommonDirectory: async () => rootDirectory,
          getHostname: () => "test-host",
          getPid: () => 123,
          isProcessAlive: (pid) => pid === 222,
        },
      ),
    ).rejects.toThrow(
      "Inbox mutation lock already held for owner/repo PR #1 on branch yamabiko-lite-inbox.",
    );

    const lockStats = await stat(freshLockPath);
    expect(lockStats.isFile()).toBe(true);
  });

  it("treats unreadable lock metadata as temporarily held", async () => {
    const sleeps: number[] = [];
    const lockDirectory = path.join(rootDirectory, "yamabiko-lite", "locks");
    const lockPath = path.join(lockDirectory, "yamabiko-lite-inbox--owner--repo--pr-1.lock");

    await mkdir(lockDirectory, { recursive: true });
    await writeFile(lockPath, "{");

    await expect(
      withInboxMutationLock(
        {
          branch: "yamabiko-lite-inbox",
          owner: "owner",
          prNumber: 1,
          repo: "repo",
        },
        async () => "recovered",
        {
          getGitCommonDirectory: async () => rootDirectory,
          sleep: async (milliseconds) => {
            sleeps.push(milliseconds);
          },
        },
      ),
    ).rejects.toThrow(
      "Inbox mutation lock already held for owner/repo PR #1 on branch yamabiko-lite-inbox.",
    );

    expect(sleeps).toHaveLength(3);
    expect(await Bun.file(lockPath).text()).toBe("{");
  });

  it("does not remove a lock held by another host", async () => {
    const lockDirectory = path.join(rootDirectory, "yamabiko-lite", "locks");
    const lockPath = path.join(lockDirectory, "yamabiko-lite-inbox--owner--repo--pr-1.lock");

    await mkdir(lockDirectory, { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({ hostname: "remote-host", pid: 999, token: "remote" }),
    );

    await expect(
      withInboxMutationLock(
        {
          branch: "yamabiko-lite-inbox",
          owner: "owner",
          prNumber: 1,
          repo: "repo",
        },
        async () => "recovered",
        {
          getGitCommonDirectory: async () => rootDirectory,
          getHostname: () => "test-host",
          getPid: () => 123,
          isProcessAlive: () => false,
        },
      ),
    ).rejects.toThrow(
      "Inbox mutation lock already held for owner/repo PR #1 on branch yamabiko-lite-inbox.",
    );
  });

  it("does not delete a newer lock file during cleanup", async () => {
    const lockDirectory = path.join(rootDirectory, "yamabiko-lite", "locks");
    const lockPath = path.join(lockDirectory, "yamabiko-lite-inbox--owner--repo--pr-1.lock");

    await mkdir(lockDirectory, { recursive: true });

    await withInboxMutationLock(
      {
        branch: "yamabiko-lite-inbox",
        owner: "owner",
        prNumber: 1,
        repo: "repo",
      },
      async () => {
        await writeFile(
          lockPath,
          JSON.stringify({ hostname: "test-host", pid: 555, token: "replacement-token" }),
        );
        return "ok";
      },
      {
        getGitCommonDirectory: async () => rootDirectory,
        getHostname: () => "test-host",
        getPid: () => 123,
      },
    );

    const currentMetadata = JSON.parse(await Bun.file(lockPath).text()) as {
      token: string;
    };
    expect(currentMetadata.token).toBe("replacement-token");
  });

  it("preserves the original operation error when lock cleanup fails", async () => {
    const warnings: string[] = [];
    const operationError = new Error("mutation failed");

    await expect(
      withInboxMutationLock(
        {
          branch: "yamabiko-lite-inbox",
          owner: "owner",
          prNumber: 1,
          repo: "repo",
        },
        async () => {
          const lockPath = path.join(
            rootDirectory,
            "yamabiko-lite",
            "locks",
            "yamabiko-lite-inbox--owner--repo--pr-1.lock",
          );
          await writeFile(
            lockPath,
            JSON.stringify({ hostname: "test-host", pid: 999, token: "replacement-token" }),
          );
          throw operationError;
        },
        {
          getGitCommonDirectory: async () => rootDirectory,
          getHostname: () => "test-host",
          getPid: () => 123,
          logWarning: (message) => warnings.push(message),
        },
      ),
    ).rejects.toBe(operationError);

    expect(warnings).toHaveLength(0);
  });
});
