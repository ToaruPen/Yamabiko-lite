export async function cleanupWorktree(worktreePath: string): Promise<void> {
  await runGit(["worktree", "remove", "--force", worktreePath]);
}

export async function commitAndPushInbox(
  worktreePath: string,
  branchName: string,
  message: string,
): Promise<boolean> {
  await runGit(["add", "--all"], { workingDirectory: worktreePath });

  const { exitCode: diffExitCode } = await runGit(["diff", "--staged", "--quiet"], {
    workingDirectory: worktreePath,
  });

  if (diffExitCode === 0) {
    return false;
  }

  const fullMessage = `${message} [skip ci]`;
  await runGit(["commit", "-m", fullMessage], {
    workingDirectory: worktreePath,
  });

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
  const worktreePath = `/tmp/yamabiko-inbox-${suffix}`;

  const { exitCode, stderr, stdout } = await runGit(["ls-remote", "--heads", "origin", branchName]);

  if (exitCode !== 0) {
    throw new Error(
      `git ls-remote failed for branch "${branchName}": ${stderr || `exit code ${String(exitCode)}`}`,
    );
  }

  if (stdout.trim()) {
    await runGit(["fetch", "origin", `${branchName}:${branchName}`]);
    await runGit(["worktree", "add", worktreePath, branchName]);
  } else {
    await runGit(["worktree", "add", "--orphan", "-b", branchName, worktreePath]);
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
    // eslint-disable-next-line unicorn/no-null -- API contract: null signals missing file
    return null;
  }

  if (exitCode !== 0) {
    throw new Error(
      `git show failed (exit ${String(exitCode)}): ${stdout || stderr}`,
    );
  }

  return stdout;
}

async function runGit(
  gitArguments: string[],
  options?: { trimStdout?: boolean; workingDirectory?: string },
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const subprocess = Bun.spawn(
    ["git", ...gitArguments],
    options?.workingDirectory
      ? { cwd: options.workingDirectory, stderr: "pipe", stdout: "pipe" }
      : { stderr: "pipe", stdout: "pipe" },
  );

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
