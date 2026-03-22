import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { inferRepoFromRemote, parseRepo } from "./parse-repo.ts";

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

describe("parseRepo", () => {
  it("parses owner/repo", () => {
    expect(parseRepo("owner/repo")).toEqual({ name: "repo", owner: "owner" });
  });

  it("normalizes owner and repo casing to lowercase", () => {
    expect(parseRepo("Owner/Repo")).toEqual({ name: "repo", owner: "owner" });
  });

  it("throws for invalid format", () => {
    expect(() => parseRepo("owner/repo/extra")).toThrow(
      'Invalid repo format: "owner/repo/extra". Expected "owner/repo".',
    );
  });

  it("throws for path traversal style components", () => {
    expect(() => parseRepo("owner/../repo")).toThrow(
      'Invalid repo format: "owner/../repo". Expected "owner/repo".',
    );
    expect(() => parseRepo("own..er/repo")).toThrow(
      'Invalid repo path components: "own..er/repo".',
    );
    expect(() => parseRepo(String.raw`owner/re\po`)).toThrow(
      String.raw`Invalid repo path components: "owner/re\po".`,
    );
  });
});

describe("inferRepoFromRemote", () => {
  let spawnMock: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    spawnMock?.mockRestore();
    spawnMock = undefined;
  });

  it("extracts owner/repo from https origin URL", async () => {
    spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess("https://github.com/example/project.git\n", 0) as any,
    );

    await (expect(inferRepoFromRemote()).resolves.toBe(
      "example/project",
    ) as unknown as Promise<void>);

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("extracts owner/repo from SSH origin URL", async () => {
    spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess("git@github.com:example/project.git\n", 0) as any,
    );

    await (expect(inferRepoFromRemote()).resolves.toBe(
      "example/project",
    ) as unknown as Promise<void>);
  });

  it("normalizes inferred repo casing from remote URL", async () => {
    spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess("https://github.com/Example/Project.git\n", 0) as any,
    );

    await (expect(inferRepoFromRemote()).resolves.toBe(
      "example/project",
    ) as unknown as Promise<void>);
  });

  it("throws when git remote get-url fails", async () => {
    spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess("", 2, "fatal: not a git repository") as any,
    );

    await (expect(inferRepoFromRemote()).rejects.toThrow(
      "Failed to infer repository from origin remote: fatal: not a git repository",
    ) as unknown as Promise<void>);
  });

  it("throws when remote URL cannot be parsed", async () => {
    spawnMock = spyOn(Bun, "spawn").mockImplementation(
      () => createMockSubprocess("origin\n", 0) as any,
    );

    await (expect(inferRepoFromRemote()).rejects.toThrow(
      "Cannot parse repository from remote URL: origin",
    ) as unknown as Promise<void>);
  });
});
