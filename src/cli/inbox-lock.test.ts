import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
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
    const lockDirectory = path.join(rootDirectory, "locks");

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
    await mkdir(lockDirectory, { recursive: true });
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
});
