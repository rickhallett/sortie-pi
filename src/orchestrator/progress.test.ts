import { describe, expect, mock, test } from "bun:test";
import { emitProgress, formatProgressLine } from "./progress.js";

describe("formatProgressLine", () => {
  test("formats sortie name and status", () => {
    const line = formatProgressLine("reviewer-claude", "reviewing diff (2,145 tokens)");
    expect(line).toBe("reviewer-claude: reviewing diff (2,145 tokens)");
  });

  test("formats completion status", () => {
    const line = formatProgressLine("reviewer-claude", "complete -- fail (2 findings)");
    expect(line).toBe("reviewer-claude: complete -- fail (2 findings)");
  });
});

describe("emitProgress", () => {
  test("calls sendCustomMessage with correct custom type and content", () => {
    const calls: unknown[] = [];
    const sendFn = (msg: unknown) => { calls.push(msg); };
    emitProgress(sendFn, "reviewer-claude", "reviewing diff");
    expect(calls).toHaveLength(1);
    const call = calls[0] as Record<string, unknown>;
    expect(call.customType).toBe("sortie:progress");
    expect(call.content).toEqual({ sortie: "reviewer-claude", status: "reviewing diff" });
    expect(call.display).toBe("reviewer-claude: reviewing diff");
  });
});
