/**
 * State model and transition validation for inbox items.
 *
 * Status lifecycle:
 *   pending → claimed → fixed     (terminal)
 *                     → skipped   (terminal)
 *                     → stale     (terminal)
 *           → stale
 */

export type InboxStatus = "claimed" | "fixed" | "pending" | "skipped" | "stale";

export const INBOX_STATUSES: readonly InboxStatus[] = [
  "pending",
  "claimed",
  "fixed",
  "skipped",
  "stale",
] as const;

export const VALID_TRANSITIONS: ReadonlyMap<InboxStatus, ReadonlySet<InboxStatus>> = new Map([
  ["claimed", new Set<InboxStatus>(["fixed", "skipped", "stale"])],
  ["fixed", new Set<InboxStatus>()],
  ["pending", new Set<InboxStatus>(["claimed", "stale"])],
  ["skipped", new Set<InboxStatus>()],
  ["stale", new Set<InboxStatus>()],
]);

export function assertValidTransition(from: InboxStatus, to: InboxStatus): void {
  if (!isValidTransition(from, to)) {
    throw new Error(
      `Invalid state transition: "${from}" → "${to}". ` +
        `Allowed transitions from "${from}": [${[...(VALID_TRANSITIONS.get(from) ?? [])].map((s) => `"${s}"`).join(", ") || "none"}].`,
    );
  }
}

export function isValidTransition(from: InboxStatus, to: InboxStatus): boolean {
  return VALID_TRANSITIONS.get(from)?.has(to) ?? false;
}
