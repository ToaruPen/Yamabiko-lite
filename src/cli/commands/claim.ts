import { defineCommand } from "citty";

import type { InboxRecord } from "../../schema/inbox-record.ts";
import type { InboxStatus } from "../../schema/state.ts";

export interface ClaimOptions {
  branch: string;
  id: string;
  pr: string;
  repo: string;
}

export interface ClaimResult {
  message: string;
  previousStatus: InboxStatus;
  updatedRecords: InboxRecord[];
}

export function applyClaimToRecords(_records: InboxRecord[], _id: string): ClaimResult {
  throw new Error("Not implemented");
}

export async function claimInboxItem(_options: ClaimOptions): Promise<string> {
  throw new Error("Not implemented");
}

export default defineCommand({
  meta: {
    description: "Claim an inbox item",
    name: "claim",
  },
  run(): void {
    console.log("Not implemented yet");
  },
});
