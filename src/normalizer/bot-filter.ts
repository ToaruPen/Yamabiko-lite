import type { GitHubUser } from "./types";

export const DEFAULT_BOT_ALLOWLIST: readonly string[] = [
  "coderabbitai[bot]",
  "github-copilot[bot]",
];

export function isAllowedBot(user: GitHubUser, allowlist: readonly string[]): boolean {
  return isBotUser(user) && allowlist.includes(user.login);
}

export function isBotUser(user: GitHubUser): boolean {
  return user.type === "Bot";
}

export function parseBotAllowlist(environmentValue: string): string[] {
  if (environmentValue.trim() === "") return [];
  return environmentValue.split(",").map((entry) => entry.trim());
}
