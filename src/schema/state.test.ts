import { describe, expect, it } from "bun:test";
import {
  INBOX_STATUSES,
  VALID_TRANSITIONS,
  assertValidTransition,
  isValidTransition,
} from "./state.ts";
import type { InboxStatus } from "./state.ts";

describe("INBOX_STATUSES", () => {
  it("contains exactly 5 statuses", () => {
    expect(INBOX_STATUSES).toHaveLength(5);
  });

  it("includes all defined statuses", () => {
    const expected: InboxStatus[] = [
      "pending",
      "claimed",
      "fixed",
      "skipped",
      "stale",
    ];
    for (const s of expected) {
      expect(INBOX_STATUSES).toContain(s);
    }
  });
});

describe("VALID_TRANSITIONS exhaustiveness", () => {
  it("every status appears as a key in the transition map", () => {
    for (const status of INBOX_STATUSES) {
      expect(VALID_TRANSITIONS.has(status)).toBe(true);
    }
  });
});

describe("isValidTransition — valid transitions", () => {
  it("pending → claimed is valid", () => {
    expect(isValidTransition("pending", "claimed")).toBe(true);
  });

  it("pending → stale is valid", () => {
    expect(isValidTransition("pending", "stale")).toBe(true);
  });

  it("claimed → fixed is valid", () => {
    expect(isValidTransition("claimed", "fixed")).toBe(true);
  });

  it("claimed → skipped is valid", () => {
    expect(isValidTransition("claimed", "skipped")).toBe(true);
  });

  it("claimed → stale is valid", () => {
    expect(isValidTransition("claimed", "stale")).toBe(true);
  });
});

describe("isValidTransition — invalid transitions", () => {
  it("fixed → pending is invalid (terminal state)", () => {
    expect(isValidTransition("fixed", "pending")).toBe(false);
  });

  it("skipped → claimed is invalid (terminal state)", () => {
    expect(isValidTransition("skipped", "claimed")).toBe(false);
  });

  it("stale → pending is invalid (terminal state)", () => {
    expect(isValidTransition("stale", "pending")).toBe(false);
  });

  it("pending → fixed is invalid (must go through claimed)", () => {
    expect(isValidTransition("pending", "fixed")).toBe(false);
  });

  it("pending → skipped is invalid (must go through claimed)", () => {
    expect(isValidTransition("pending", "skipped")).toBe(false);
  });

  it("fixed → claimed is invalid (terminal state)", () => {
    expect(isValidTransition("fixed", "claimed")).toBe(false);
  });
});

describe("assertValidTransition", () => {
  it("does NOT throw for valid transition pending → claimed", () => {
    expect(() => assertValidTransition("pending", "claimed")).not.toThrow();
  });

  it("does NOT throw for valid transition claimed → fixed", () => {
    expect(() => assertValidTransition("claimed", "fixed")).not.toThrow();
  });

  it("throws for invalid transition fixed → pending", () => {
    expect(() => assertValidTransition("fixed", "pending")).toThrow();
  });

  it("throws with descriptive message including from and to values", () => {
    let errorMessage = "";
    try {
      assertValidTransition("fixed", "pending");
    } catch (e) {
      errorMessage = (e as Error).message;
    }
    expect(errorMessage).toContain("fixed");
    expect(errorMessage).toContain("pending");
  });

  it("throws with descriptive message for skipped → claimed", () => {
    let errorMessage = "";
    try {
      assertValidTransition("skipped", "claimed");
    } catch (e) {
      errorMessage = (e as Error).message;
    }
    expect(errorMessage).toContain("skipped");
    expect(errorMessage).toContain("claimed");
  });
});
