import { describe, expect, it } from "bun:test";
import { DEFAULT_BOT_ALLOWLIST, isAllowedBot, isBotUser, parseBotAllowlist } from "./bot-filter";
import type { GitHubUser } from "./types";

const botUser: GitHubUser = { id: 1, login: "coderabbitai[bot]", type: "Bot" };
const humanUser: GitHubUser = { id: 2, login: "alice", type: "User" };
const orgUser: GitHubUser = { id: 3, login: "my-org", type: "Organization" };
const unknownBot: GitHubUser = { id: 4, login: "unknown-bot[bot]", type: "Bot" };

describe("isBotUser", () => {
  it("returns true for Bot type", () => {
    expect(isBotUser(botUser)).toBe(true);
  });

  it("returns false for User type", () => {
    expect(isBotUser(humanUser)).toBe(false);
  });

  it("returns false for Organization type", () => {
    expect(isBotUser(orgUser)).toBe(false);
  });
});

describe("isAllowedBot", () => {
  it("returns true when bot login is in allowlist", () => {
    expect(isAllowedBot(botUser, ["coderabbitai[bot]"])).toBe(true);
  });

  it("returns false when bot login is NOT in allowlist", () => {
    expect(isAllowedBot(unknownBot, ["coderabbitai[bot]"])).toBe(false);
  });

  it("returns false when user is not a bot even if login is in allowlist", () => {
    const humanWithBotName: GitHubUser = { id: 5, login: "coderabbitai[bot]", type: "User" };
    expect(isAllowedBot(humanWithBotName, ["coderabbitai[bot]"])).toBe(false);
  });
});

describe("DEFAULT_BOT_ALLOWLIST", () => {
  it("contains coderabbitai[bot] and github-copilot[bot]", () => {
    expect(DEFAULT_BOT_ALLOWLIST).toContain("coderabbitai[bot]");
    expect(DEFAULT_BOT_ALLOWLIST).toContain("github-copilot[bot]");
    expect(DEFAULT_BOT_ALLOWLIST).toHaveLength(2);
  });
});

describe("parseBotAllowlist", () => {
  it("parses comma-separated values into array", () => {
    const result = parseBotAllowlist("coderabbitai[bot],github-copilot[bot]");
    expect(result).toEqual(["coderabbitai[bot]", "github-copilot[bot]"]);
  });

  it("trims whitespace from each entry", () => {
    const result = parseBotAllowlist(" coderabbitai[bot] , github-copilot[bot] ");
    expect(result).toEqual(["coderabbitai[bot]", "github-copilot[bot]"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseBotAllowlist("")).toEqual([]);
  });
});
