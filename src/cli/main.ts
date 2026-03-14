#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";

import packageJson from "../../package.json";

const inbox = defineCommand({
  meta: {
    description: "Manage inbox items",
    name: "inbox",
  },
  subCommands: {
    claim: async () => import("./commands/claim.ts").then((m) => m.default),
    list: async () => import("./commands/list.ts").then((m) => m.default),
    resolve: async () => import("./commands/resolve.ts").then((m) => m.default),
  },
});

const main = defineCommand({
  meta: {
    description: "Lightweight inbox-driven PR remediation",
    name: "yamabiko-lite",
    version: packageJson.version,
  },
  subCommands: {
    inbox,
  },
});

await runMain(main);
