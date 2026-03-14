export async function inferRepoFromRemote(): Promise<string> {
  const subprocess = Bun.spawn(["git", "remote", "get-url", "origin"], {
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
      `Failed to infer repository from origin remote: ${stderr.trim() || `exit code ${String(exitCode)}`}`,
    );
  }

  const url = stdout.trim();
  const match = /[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);

  if (!match?.[1] || !match[2]) {
    throw new Error(`Cannot parse repository from remote URL: ${url}`);
  }

  return `${match[1]}/${match[2]}`;
}

export function parseRepo(repo: string): { name: string; owner: string } {
  const parts = repo.split("/");
  const owner = parts[0];
  const name = parts[1];

  if (
    parts.length !== 2 ||
    owner === undefined ||
    name === undefined ||
    owner === "" ||
    name === ""
  ) {
    throw new Error(`Invalid repo format: "${repo}". Expected "owner/repo".`);
  }

  if (owner.includes("..") || name.includes("..") || owner.includes("\\") || name.includes("\\")) {
    throw new Error(`Invalid repo path components: "${repo}".`);
  }

  return { name, owner };
}
