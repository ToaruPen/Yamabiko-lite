import { describe, expect, it, spyOn } from "bun:test";

import {
  cleanupWorktree,
  commitAndPushInbox,
  ensureInboxBranch,
  readFileFromBranch,
} from "./branch.ts";

function createMockSubprocess(standardOutput: string, exitCode: number, standardError = "") {
  return {
    exited: Promise.resolve(exitCode),
    stderr: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(standardError));
        controller.close();
      },
    }),
    stdout: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(standardOutput));
        controller.close();
      },
    }),
  };
}

describe("readFileFromBranch", () => {
  it("returns file content when file exists", async () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess("file content here\n", 0) as any,
    );

    const result = await readFileFromBranch("inbox", "data.jsonl");

    expect(result).toBe("file content here\n");
    expect(spawnMock).toHaveBeenCalledTimes(1);

    spawnMock.mockRestore();
  });

  it("returns null for non-existent file", async () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () =>
        createMockSubprocess("", 128, "fatal: path 'missing.txt' does not exist in 'inbox'") as any,
    );

    const result = await readFileFromBranch("inbox", "missing.txt");

    expect(result).toBeNull();

    spawnMock.mockRestore();
  });

  it("throws for exit 128 when error is not missing file", () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () =>
        createMockSubprocess("", 128, "fatal: ambiguous argument 'HEAD': unknown revision") as any,
    );

    expect(readFileFromBranch("unknown-branch", "missing.txt")).rejects.toThrow(
      "git show failed (exit 128): fatal: ambiguous argument 'HEAD': unknown revision",
    );

    spawnMock.mockRestore();
  });

  it("returns null for unborn orphan branch", async () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () =>
        createMockSubprocess("", 128, "fatal: invalid object name 'yamabiko-lite-inbox'") as any,
    );

    const result = await readFileFromBranch("yamabiko-lite-inbox", "data.jsonl");
    expect(result).toBeNull();

    spawnMock.mockRestore();
  });
});

describe("commitAndPushInbox", () => {
  it("returns false when nothing to commit", async () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation((commandArguments: any) => {
      if (commandArguments.includes("diff")) {
        return createMockSubprocess("", 0) as any;
      }
      return createMockSubprocess("", 0) as any;
    });

    const result = await commitAndPushInbox("/tmp/worktree", "inbox", "test");

    expect(result).toBe(false);
    const addCall = spawnMock.mock.calls.find((callArguments: any) =>
      callArguments[0]?.includes?.("add"),
    );
    expect(addCall).toBeDefined();
    const addCommandArguments = addCall![0] as string[];
    expect(addCommandArguments).toContain(".yamabiko-lite");
    expect(addCommandArguments).not.toContain("--all");

    spawnMock.mockRestore();
  });

  it("throws when git add exits non-zero", () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation((commandArguments: any) => {
      if (commandArguments.includes("add")) {
        return createMockSubprocess("", 2, "fatal: unable to add files") as any;
      }
      return createMockSubprocess("", 0) as any;
    });

    expect(commitAndPushInbox("/tmp/worktree", "inbox", "test")).rejects.toThrow(
      "git add failed (exit 2): fatal: unable to add files",
    );

    spawnMock.mockRestore();
  });

  it("throws when git diff --staged --quiet exits with unexpected code", () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation((commandArguments: any) => {
      if (commandArguments.includes("diff")) {
        return createMockSubprocess("", 2, "fatal: bad revision") as any;
      }
      return createMockSubprocess("", 0) as any;
    });

    expect(commitAndPushInbox("/tmp/worktree", "inbox", "test")).rejects.toThrow(
      "git diff --staged --quiet failed (exit 2): fatal: bad revision",
    );

    spawnMock.mockRestore();
  });

  it("includes [skip ci] in commit message", async () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation((commandArguments: any) => {
      if (commandArguments.includes("diff")) {
        return createMockSubprocess("", 1) as any;
      }
      return createMockSubprocess("", 0) as any;
    });

    await commitAndPushInbox("/tmp/worktree", "inbox", "update records");

    const commitCall = spawnMock.mock.calls.find((callArguments: any) =>
      callArguments[0]?.includes?.("commit"),
    );
    expect(commitCall).toBeDefined();
    const commandArray = commitCall![0] as string[];
    const messageIndex = commandArray.indexOf("-m") + 1;
    expect(commandArray[messageIndex]).toContain("[skip ci]");

    spawnMock.mockRestore();
  });

  it("retries on push failure", async () => {
    let pushCount = 0;
    const spawnMock = spyOn(Bun, "spawn").mockImplementation((commandArguments: any) => {
      if (commandArguments.includes("diff")) {
        return createMockSubprocess("", 1) as any;
      }
      if (commandArguments.includes("push")) {
        pushCount++;
        if (pushCount === 1) {
          return createMockSubprocess("error: failed", 1) as any;
        }
        return createMockSubprocess("", 0) as any;
      }
      return createMockSubprocess("", 0) as any;
    });
    const sleepMock = spyOn(Bun, "sleep").mockResolvedValue(undefined as any);

    const result = await commitAndPushInbox("/tmp/worktree", "inbox", "retry test");

    expect(result).toBe(true);
    expect(pushCount).toBe(2);
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).toHaveBeenCalledWith(1000);

    spawnMock.mockRestore();
    sleepMock.mockRestore();
  });
});

describe("ensureInboxBranch", () => {
  it("creates orphan when branch does not exist", async () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation((commandArguments: any) => {
      if (commandArguments.includes("ls-remote")) {
        return createMockSubprocess("", 0) as any;
      }
      return createMockSubprocess("", 0) as any;
    });

    const result = await ensureInboxBranch("yamabiko/inbox");

    expect(result).toMatch(/^\/tmp\/yamabiko-inbox-/);
    const orphanCall = spawnMock.mock.calls.find((callArguments: any) =>
      callArguments[0]?.includes?.("--orphan"),
    );
    expect(orphanCall).toBeDefined();

    spawnMock.mockRestore();
  });

  it("checks out existing branch", async () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation((commandArguments: any) => {
      if (commandArguments.includes("ls-remote")) {
        return createMockSubprocess("abc123\trefs/heads/yamabiko/inbox\n", 0) as any;
      }
      return createMockSubprocess("", 0) as any;
    });

    const result = await ensureInboxBranch("yamabiko/inbox");

    expect(result).toMatch(/^\/tmp\/yamabiko-inbox-/);
    const fetchCall = spawnMock.mock.calls.find((callArguments: any) =>
      callArguments[0]?.includes?.("fetch"),
    );
    expect(fetchCall).toBeDefined();
    const orphanCall = spawnMock.mock.calls.find((callArguments: any) =>
      callArguments[0]?.includes?.("--orphan"),
    );
    expect(orphanCall).toBeUndefined();

    spawnMock.mockRestore();
  });

  it("throws when git ls-remote exits non-zero", () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation((commandArguments: any) => {
      if (commandArguments.includes("ls-remote")) {
        return createMockSubprocess("", 2, "fatal: unable to access remote") as any;
      }
      return createMockSubprocess("", 0) as any;
    });

    expect(ensureInboxBranch("yamabiko/inbox")).rejects.toThrow(
      'git ls-remote failed for branch "yamabiko/inbox": fatal: unable to access remote',
    );

    spawnMock.mockRestore();
  });

  it("throws when git fetch exits non-zero", () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation((commandArguments: any) => {
      if (commandArguments.includes("ls-remote")) {
        return createMockSubprocess("abc123\trefs/heads/yamabiko/inbox\n", 0) as any;
      }

      if (commandArguments.includes("fetch")) {
        return createMockSubprocess("", 1, "fatal: fetch failed") as any;
      }

      return createMockSubprocess("", 0) as any;
    });

    expect(ensureInboxBranch("yamabiko/inbox")).rejects.toThrow(
      "git fetch failed (exit 1): fatal: fetch failed",
    );

    spawnMock.mockRestore();
  });

  it("throws when git worktree add exits non-zero for existing branch", () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation((commandArguments: any) => {
      if (commandArguments.includes("ls-remote")) {
        return createMockSubprocess("abc123\trefs/heads/yamabiko/inbox\n", 0) as any;
      }

      if (commandArguments.includes("fetch")) {
        return createMockSubprocess("", 0) as any;
      }

      if (commandArguments.includes("worktree") && commandArguments.includes("add")) {
        return createMockSubprocess("", 1, "fatal: cannot create worktree") as any;
      }

      return createMockSubprocess("", 0) as any;
    });

    expect(ensureInboxBranch("yamabiko/inbox")).rejects.toThrow(
      "git worktree add failed (exit 1): fatal: cannot create worktree",
    );

    spawnMock.mockRestore();
  });

  it("throws when git worktree add --orphan exits non-zero", () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation((commandArguments: any) => {
      if (commandArguments.includes("ls-remote")) {
        return createMockSubprocess("", 0) as any;
      }

      if (commandArguments.includes("worktree") && commandArguments.includes("--orphan")) {
        return createMockSubprocess("", 1, "fatal: orphan creation failed") as any;
      }

      return createMockSubprocess("", 0) as any;
    });

    expect(ensureInboxBranch("yamabiko/inbox")).rejects.toThrow(
      "git worktree add --orphan failed (exit 1): fatal: orphan creation failed",
    );

    spawnMock.mockRestore();
  });
});

describe("cleanupWorktree", () => {
  it("calls git worktree remove", async () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess("", 0) as any,
    );

    await cleanupWorktree("/tmp/yamabiko-inbox-test123");

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const callArguments = spawnMock.mock.calls[0]![0] as string[];
    expect(callArguments).toContain("worktree");
    expect(callArguments).toContain("remove");
    expect(callArguments).toContain("--force");
    expect(callArguments).toContain("/tmp/yamabiko-inbox-test123");

    spawnMock.mockRestore();
  });

  it("throws when git worktree remove exits non-zero", () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess("", 1, "fatal: failed to remove worktree") as any,
    );

    expect(cleanupWorktree("/tmp/yamabiko-inbox-test123")).rejects.toThrow(
      "git worktree remove failed (exit 1): fatal: failed to remove worktree",
    );

    spawnMock.mockRestore();
  });
});
