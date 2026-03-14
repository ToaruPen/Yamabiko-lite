export async function cleanupWorktree(_worktreePath: string): Promise<void> {
  throw new Error("Not implemented");
}

export async function commitAndPushInbox(
  _worktreePath: string,
  _branchName: string,
  _message: string,
): Promise<boolean> {
  throw new Error("Not implemented");
}

export async function ensureInboxBranch(_branchName: string): Promise<string> {
  throw new Error("Not implemented");
}

export async function readFileFromBranch(
  _branchName: string,
  _filePath: string,
): Promise<null | string> {
  throw new Error("Not implemented");
}
