import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
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
        },
      ),
    ).rejects.toBe(operationError);
  });

  it("recovers stale lock files before rejecting a new mutation", async () => {
    const now = new Date("2026-03-14T14:00:00.000Z");
    const staleTime = new Date(now.getTime() - 10 * 60 * 1000);
    const lockDirectory = path.join(rootDirectory, "yamabiko-lite", "locks");
    const staleLockPath = path.join(lockDirectory, "yamabiko-lite-inbox--owner--repo--pr-1.lock");

    await mkdir(lockDirectory, { recursive: true });
    await writeFile(staleLockPath, "stale-lock");
    await utimes(staleLockPath, staleTime, staleTime);

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
        now: () => now.getTime(),
      },
    );

    expect(result).toBe("recovered");
    expect(await readdir(lockDirectory)).toEqual([]);
  });

  it("keeps rejecting fresh lock files", async () => {
    const now = new Date("2026-03-14T14:00:00.000Z");
    const freshTime = new Date(now.getTime() - 10 * 1000);
    const lockDirectory = path.join(rootDirectory, "yamabiko-lite", "locks");
    const freshLockPath = path.join(lockDirectory, "yamabiko-lite-inbox--owner--repo--pr-1.lock");

    await mkdir(lockDirectory, { recursive: true });
    await writeFile(freshLockPath, "fresh-lock");
    await utimes(freshLockPath, freshTime, freshTime);

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
          now: () => now.getTime(),
        },
      ),
    ).rejects.toThrow(
      "Inbox mutation lock already held for owner/repo PR #1 on branch yamabiko-lite-inbox.",
    );

    const lockStats = await stat(freshLockPath);
    expect(lockStats.isFile()).toBe(true);
  });
});
