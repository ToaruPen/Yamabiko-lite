import { describe, expect, it, spyOn } from "bun:test";

import {
  cleanupWorktree,
  commitAndPushInbox,
  ensureInboxBranch,
  readFileFromBranch,
} from "./branch.ts";

function createMockSubprocess(standardOutput: string, exitCode: number) {
  return {
    exited: Promise.resolve(exitCode),
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

    expect(result).toBe("file content here");
    expect(spawnMock).toHaveBeenCalledTimes(1);

    spawnMock.mockRestore();
  });

  it("returns null for non-existent file", async () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess("", 128) as any,
    );

    const result = await readFileFromBranch("inbox", "missing.txt");

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
});
