import { tmpdir } from "node:os";
import path from "node:path";

export async function cleanupWorktree(worktreePath: string): Promise<void> {
  const { exitCode, stderr } = await runGit(["worktree", "remove", "--force", worktreePath]);

  if (exitCode !== 0) {
    throw new Error(`git worktree remove failed (exit ${String(exitCode)}): ${stderr}`);
  }
}

export async function commitAndPushInbox(
  worktreePath: string,
  branchName: string,
  message: string,
): Promise<boolean> {
  const { exitCode: addExitCode, stderr: addStderr } = await runGit(["add", ".yamabiko-lite"], {
    workingDirectory: worktreePath,
  });

  if (addExitCode !== 0) {
    throw new Error(`git add failed (exit ${String(addExitCode)}): ${addStderr}`);
  }

  const { exitCode: diffExitCode, stderr: diffStderr } = await runGit(
    ["diff", "--staged", "--quiet"],
    {
      workingDirectory: worktreePath,
    },
  );

  if (diffExitCode === 0) {
    return false;
  }

  if (diffExitCode !== 1) {
    throw new Error(
      `git diff --staged --quiet failed (exit ${String(diffExitCode)}): ${diffStderr}`,
    );
  }

  const fullMessage = `${message} [skip ci]`;
  const { exitCode: commitExitCode, stderr: commitStderr } = await runGit(
    ["commit", "-m", fullMessage],
    { workingDirectory: worktreePath },
  );

  if (commitExitCode !== 0) {
    throw new Error(`git commit failed (exit ${String(commitExitCode)}): ${commitStderr}`);
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { exitCode: pushExitCode } = await runGit(["push", "origin", branchName], {
      workingDirectory: worktreePath,
    });

    if (pushExitCode === 0) {
      return true;
    }

    if (attempt < maxAttempts) {
      await Bun.sleep(1000);
    }
  }

  throw new Error(`Push to ${branchName} failed after ${String(maxAttempts)} attempts`);
}

export async function ensureInboxBranch(branchName: string): Promise<string> {
  const suffix = `${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
  const worktreePath = path.join(tmpdir(), `yamabiko-inbox-${suffix}`);

  const { exitCode, stderr, stdout } = await runGit(["ls-remote", "--heads", "origin", branchName]);

  if (exitCode !== 0) {
    throw new Error(
      `git ls-remote failed for branch "${branchName}": ${stderr || `exit code ${String(exitCode)}`}`,
    );
  }

  if (stdout.trim()) {
    const { exitCode: fetchExitCode, stderr: fetchStderr } = await runGit([
      "fetch",
      "origin",
      `${branchName}:${branchName}`,
    ]);

    if (fetchExitCode !== 0) {
      throw new Error(`git fetch failed (exit ${String(fetchExitCode)}): ${fetchStderr}`);
    }

    const { exitCode: worktreeExitCode, stderr: worktreeStderr } = await runGit([
      "worktree",
      "add",
      worktreePath,
      branchName,
    ]);

    if (worktreeExitCode !== 0) {
      throw new Error(
        `git worktree add failed (exit ${String(worktreeExitCode)}): ${worktreeStderr}`,
      );
    }
  } else {
    const { exitCode: localExitCode } = await runGit([
      "rev-parse",
      "--verify",
      `refs/heads/${branchName}`,
    ]);

    if (localExitCode === 0) {
      const { exitCode: worktreeExitCode, stderr: worktreeStderr } = await runGit([
        "worktree",
        "add",
        worktreePath,
        branchName,
      ]);

      if (worktreeExitCode !== 0) {
        throw new Error(
          `git worktree add failed (exit ${String(worktreeExitCode)}): ${worktreeStderr}`,
        );
      }
    } else {
      const { exitCode: orphanExitCode, stderr: orphanStderr } = await runGit([
        "worktree",
        "add",
        "--orphan",
        "-b",
        branchName,
        worktreePath,
      ]);

      if (orphanExitCode !== 0) {
        throw new Error(
          `git worktree add --orphan failed (exit ${String(orphanExitCode)}): ${orphanStderr}`,
        );
      }
    }
  }

  return worktreePath;
}

export async function readFileFromBranch(
  branchName: string,
  filePath: string,
): Promise<null | string> {
  const { exitCode, stderr, stdout } = await runGit(["show", `${branchName}:${filePath}`], {
    trimStdout: false,
  });

  if (exitCode === 128) {
    if (
      stderr.includes("does not exist") ||
      stderr.includes("exists on disk, but not in") ||
      stderr.includes("invalid object name")
    ) {
      // eslint-disable-next-line unicorn/no-null -- API contract: null signals missing file
      return null;
    }

    throw new Error(`git show failed (exit 128): ${stderr}`);
  }

  if (exitCode !== 0) {
    throw new Error(`git show failed (exit ${String(exitCode)}): ${stdout || stderr}`);
  }

  return stdout;
}

async function runGit(
  gitArguments: string[],
  options?: { trimStdout?: boolean; workingDirectory?: string },
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const spawnOptions: Record<string, unknown> = {
    env: { ...process.env, LC_ALL: "C" },
    stderr: "pipe",
    stdout: "pipe",
  };

  if (options?.workingDirectory) {
    spawnOptions["cwd"] = options.workingDirectory;
  }

  const subprocess = Bun.spawn(["git", ...gitArguments], spawnOptions);

  const [stderrText, stdoutText, exitCode] = await Promise.all([
    new Response(subprocess.stderr).text(),
    new Response(subprocess.stdout).text(),
    subprocess.exited,
  ]);

  return {
    exitCode,
    stderr: stderrText.trim(),
    stdout: options?.trimStdout === false ? stdoutText : stdoutText.trim(),
  };
}
