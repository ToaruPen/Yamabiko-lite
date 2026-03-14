import type { GitHubUser } from "./types";

export const DEFAULT_BOT_ALLOWLIST: readonly string[] = [
  "coderabbitai[bot]",
  "github-copilot[bot]",
];

export function isBotUser(user: GitHubUser): boolean {
  return user.type === "Bot";
}

export function isAllowedBot(user: GitHubUser, allowlist: readonly string[]): boolean {
  return isBotUser(user) && allowlist.includes(user.login);
}

export function parseBotAllowlist(envValue: string): string[] {
  if (envValue.trim() === "") return [];
  return envValue.split(",").map((entry) => entry.trim());
}
