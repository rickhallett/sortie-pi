// Reviewer invoker tests — SORTIE_PROTOCOL_v3.md Sections 7.2-7.6
// Written FIRST (TDD red phase)

import { describe, test, expect } from "bun:test";
import { parseReviewerOutput, invokeReviewer, invokeAll } from "./invoker.js";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { ReviewerOutput } from "../contracts/types.js";

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

interface MockSessionStats {
  sessionFile?: string;
  sessionId?: string;
  userMessages?: number;
  assistantMessages?: number;
  toolCalls?: number;
  toolResults?: number;
  totalMessages?: number;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost?: number;
}

function createMockSession(
  responseText: string,
  stats?: Partial<MockSessionStats>,
  opts?: { promptDelay?: number; promptError?: Error }
): AgentSession {
  return {
    prompt: async () => {
      if (opts?.promptDelay) {
        await new Promise((resolve) => setTimeout(resolve, opts.promptDelay));
      }
      if (opts?.promptError) {
        throw opts.promptError;
      }
    },
    getLastAssistantText: () => responseText,
    getSessionStats: () => ({
      sessionFile: undefined,
      sessionId: "test",
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 2,
      tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
      cost: 0.001,
      ...stats,
    }),
    dispose: () => {},
    subscribe: () => () => {},
  } as unknown as AgentSession;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_YAML = `model: claude-sonnet-4-20250514
verdict: pass_with_findings
findings:
  - id: F001
    severity: major
    file: src/index.ts
    line: 42
    category: correctness
    summary: Off-by-one error in loop boundary
    detail: The loop iterates one too many times, causing an index out of bounds.`;

const VALID_YAML_PASS = `model: claude-sonnet-4-20250514
verdict: pass
findings: []`;

const VALID_YAML_FENCED = "```yaml\n" + VALID_YAML + "\n```";

const VALID_YAML_FENCED_NO_LANG = "```\n" + VALID_YAML + "\n```";

const INVALID_YAML = `this is: [not: valid: yaml: {{{{`;

const MISSING_FIELDS_YAML = `model: claude-sonnet-4-20250514
some_other_field: true`;

// ---------------------------------------------------------------------------
// parseReviewerOutput
// ---------------------------------------------------------------------------

describe("parseReviewerOutput", () => {
  test("valid YAML with all fields parses correctly", () => {
    const result = parseReviewerOutput(VALID_YAML, "claude-sonnet-4-20250514");
    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.verdict).toBe("pass_with_findings");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].id).toBe("F001");
    expect(result.findings[0].severity).toBe("major");
    expect(result.findings[0].file).toBe("src/index.ts");
    expect(result.findings[0].line).toBe(42);
    expect(result.findings[0].category).toBe("correctness");
    expect(result.findings[0].summary).toBe("Off-by-one error in loop boundary");
    expect(result.findings[0].detail).toBe(
      "The loop iterates one too many times, causing an index out of bounds."
    );
    expect(result.error).toBeNull();
  });

  test("YAML wrapped in ```yaml fences gets stripped and parsed", () => {
    const result = parseReviewerOutput(VALID_YAML_FENCED, "claude-sonnet-4-20250514");
    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.verdict).toBe("pass_with_findings");
    expect(result.findings).toHaveLength(1);
    expect(result.error).toBeNull();
  });

  test("YAML wrapped in ``` (no language) fences gets stripped", () => {
    const result = parseReviewerOutput(VALID_YAML_FENCED_NO_LANG, "claude-sonnet-4-20250514");
    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.verdict).toBe("pass_with_findings");
    expect(result.findings).toHaveLength(1);
    expect(result.error).toBeNull();
  });

  test("invalid YAML returns error ReviewerOutput", () => {
    const result = parseReviewerOutput(INVALID_YAML, "test-model");
    expect(result.model).toBe("test-model");
    expect(result.verdict).toBe("error");
    expect(result.findings).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(typeof result.error).toBe("string");
  });

  test("missing required fields returns error ReviewerOutput", () => {
    const result = parseReviewerOutput(MISSING_FIELDS_YAML, "test-model");
    expect(result.model).toBe("test-model");
    expect(result.verdict).toBe("error");
    expect(result.findings).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  test("preserves raw_output in successful parse", () => {
    const result = parseReviewerOutput(VALID_YAML, "claude-sonnet-4-20250514");
    expect(result.raw_output).toBe(VALID_YAML);
  });

  test("preserves raw_output in error case", () => {
    const result = parseReviewerOutput(INVALID_YAML, "test-model");
    expect(result.raw_output).toBe(INVALID_YAML);
  });

  test("pass verdict with empty findings", () => {
    const result = parseReviewerOutput(VALID_YAML_PASS, "claude-sonnet-4-20250514");
    expect(result.verdict).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.error).toBeNull();
  });

  test("uses model from YAML output, not the fallback parameter", () => {
    const result = parseReviewerOutput(VALID_YAML, "fallback-model");
    // The model in the YAML is "claude-sonnet-4-20250514"
    expect(result.model).toBe("claude-sonnet-4-20250514");
  });
});

// ---------------------------------------------------------------------------
// parseReviewerOutput — malformed findings
// ---------------------------------------------------------------------------

describe("parseReviewerOutput — malformed findings", () => {
  test("finding missing id returns error", () => {
    const yaml = `verdict: pass_with_findings\nfindings:\n  - severity: minor\n    file: a.ts\n    line: 1\n    category: style\n    summary: x\n    detail: y`;
    const result = parseReviewerOutput(yaml, "test");
    expect(result.verdict).toBe("error");
    expect(result.error).toContain("id");
  });

  test("finding with invalid severity returns error", () => {
    const yaml = `verdict: pass_with_findings\nfindings:\n  - id: F001\n    severity: catastrophic\n    file: a.ts\n    line: 1\n    category: style\n    summary: x\n    detail: y`;
    const result = parseReviewerOutput(yaml, "test");
    expect(result.verdict).toBe("error");
    expect(result.error).toContain("severity");
  });

  test("finding missing file returns error", () => {
    const yaml = `verdict: pass_with_findings\nfindings:\n  - id: F001\n    severity: minor\n    line: 1\n    category: style\n    summary: x\n    detail: y`;
    const result = parseReviewerOutput(yaml, "test");
    expect(result.verdict).toBe("error");
    expect(result.error).toContain("file");
  });

  test("finding with non-numeric line returns error", () => {
    const yaml = `verdict: pass_with_findings\nfindings:\n  - id: F001\n    severity: minor\n    file: a.ts\n    line: "ten"\n    category: style\n    summary: x\n    detail: y`;
    const result = parseReviewerOutput(yaml, "test");
    expect(result.verdict).toBe("error");
    expect(result.error).toContain("line");
  });
});

// ---------------------------------------------------------------------------
// parseReviewerOutput — verdict consistency
// ---------------------------------------------------------------------------

describe("parseReviewerOutput — verdict consistency", () => {
  test("verdict 'pass' with findings returns error", () => {
    const yaml = `verdict: pass\nfindings:\n  - id: F001\n    severity: minor\n    file: a.ts\n    line: 1\n    category: style\n    summary: x\n    detail: y`;
    const result = parseReviewerOutput(yaml, "test");
    expect(result.verdict).toBe("error");
    expect(result.error).toContain("pass");
  });

  test("verdict 'fail' without critical finding returns error", () => {
    const yaml = `verdict: fail\nfindings:\n  - id: F001\n    severity: minor\n    file: a.ts\n    line: 1\n    category: style\n    summary: x\n    detail: y`;
    const result = parseReviewerOutput(yaml, "test");
    expect(result.verdict).toBe("error");
    expect(result.error).toContain("fail");
  });

  test("verdict 'pass_with_findings' with empty findings returns error", () => {
    const yaml = `verdict: pass_with_findings\nfindings: []`;
    const result = parseReviewerOutput(yaml, "test");
    expect(result.verdict).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// invokeReviewer
// ---------------------------------------------------------------------------

describe("invokeReviewer", () => {
  test("successful invocation returns parsed ReviewerOutput with tokens and wall_time_ms", async () => {
    const session = createMockSession(VALID_YAML, {
      tokens: { input: 200, output: 100, cacheRead: 10, cacheWrite: 20, total: 330 },
      cost: 0.005,
    });

    const result = await invokeReviewer(session, "Review this code", "claude-sonnet-4-20250514");

    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.verdict).toBe("pass_with_findings");
    expect(result.findings).toHaveLength(1);
    expect(result.tokens).toEqual({
      input: 200,
      output: 100,
      cacheRead: 10,
      cacheWrite: 20,
      total: 330,
    });
    expect(result.cost).toBe(0.005);
    expect(typeof result.wall_time_ms).toBe("number");
    expect(result.wall_time_ms).toBeGreaterThanOrEqual(0);
    expect(result.raw_output).toBe(VALID_YAML);
    expect(result.error).toBeNull();
  });

  test("session that returns unparseable text returns error ReviewerOutput", async () => {
    const session = createMockSession("This is not YAML at all!!!");

    const result = await invokeReviewer(session, "Review this code", "test-model");

    expect(result.model).toBe("test-model");
    expect(result.verdict).toBe("error");
    expect(result.findings).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(typeof result.wall_time_ms).toBe("number");
    expect(result.tokens).toBeDefined();
    expect(result.cost).toBeDefined();
  });

  test("session prompt error returns error ReviewerOutput", async () => {
    const session = createMockSession("", {}, { promptError: new Error("API rate limited") });

    const result = await invokeReviewer(session, "Review this code", "test-model");

    expect(result.model).toBe("test-model");
    expect(result.verdict).toBe("error");
    expect(result.findings).toEqual([]);
    expect(result.error).toContain("API rate limited");
    expect(typeof result.wall_time_ms).toBe("number");
  });

  test("timeout returns error ReviewerOutput", async () => {
    const session = createMockSession(VALID_YAML, {}, { promptDelay: 500 });

    const result = await invokeReviewer(session, "Review this code", "test-model", 50);

    expect(result.model).toBe("test-model");
    expect(result.verdict).toBe("error");
    expect(result.findings).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(result.error!.toLowerCase()).toContain("timeout");
    expect(typeof result.wall_time_ms).toBe("number");
  });

  test("timeout calls session.dispose() to stop orphaned LLM call (VERIFY-001)", async () => {
    let disposed = false;
    const session = {
      prompt: async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
      },
      getLastAssistantText: () => "",
      getSessionStats: () => ({
        sessionFile: undefined,
        sessionId: "test",
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 2,
        tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
        cost: 0.001,
      }),
      dispose: () => { disposed = true; },
      subscribe: () => () => {},
    } as unknown as AgentSession;

    await invokeReviewer(session, "Review this code", "test-model", 50);
    expect(disposed).toBe(true);
  });

  test("wall_time_ms reflects actual elapsed time", async () => {
    const session = createMockSession(VALID_YAML_PASS, {}, { promptDelay: 50 });

    const result = await invokeReviewer(session, "Review this code", "claude-sonnet-4-20250514");

    // Should be at least ~50ms due to the delay
    expect(result.wall_time_ms).toBeGreaterThanOrEqual(40);
  });

  test("session returning undefined text returns error ReviewerOutput", async () => {
    const session = {
      prompt: async () => {},
      getLastAssistantText: () => undefined,
      getSessionStats: () => ({
        sessionFile: undefined,
        sessionId: "test",
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 2,
        tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
        cost: 0.001,
      }),
      dispose: () => {},
      subscribe: () => () => {},
    } as unknown as AgentSession;

    const result = await invokeReviewer(session, "Review this code", "test-model");

    expect(result.model).toBe("test-model");
    expect(result.verdict).toBe("error");
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// invokeAll
// ---------------------------------------------------------------------------

describe("invokeAll", () => {
  test("multiple reviewers run in parallel and all results returned", async () => {
    const session1 = createMockSession(VALID_YAML);
    const session2 = createMockSession(VALID_YAML_PASS);

    const results = await invokeAll([
      { session: session1, prompt: "Review this", model: "model-a" },
      { session: session2, prompt: "Review this", model: "model-b" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].verdict).toBe("pass_with_findings");
    expect(results[1].verdict).toBe("pass");
  });

  test("one failure does not block others", async () => {
    const goodSession = createMockSession(VALID_YAML_PASS);
    const badSession = createMockSession("", {}, { promptError: new Error("Session crashed") });

    const results = await invokeAll([
      { session: goodSession, prompt: "Review this", model: "model-a" },
      { session: badSession, prompt: "Review this", model: "model-b" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].verdict).toBe("pass");
    expect(results[0].error).toBeNull();
    expect(results[1].verdict).toBe("error");
    expect(results[1].error).toBeTruthy();
  });

  test("results maintain order matching input entries", async () => {
    const sessionA = createMockSession(VALID_YAML_PASS, {}, { promptDelay: 80 });
    const sessionB = createMockSession(VALID_YAML, {}, { promptDelay: 10 });

    const results = await invokeAll([
      { session: sessionA, prompt: "Review", model: "slow-model" },
      { session: sessionB, prompt: "Review", model: "fast-model" },
    ]);

    expect(results).toHaveLength(2);
    // First result corresponds to slow-model (first entry), even though fast-model finishes first
    expect(results[0].verdict).toBe("pass");
    expect(results[1].verdict).toBe("pass_with_findings");
  });

  test("empty entries array returns empty results", async () => {
    const results = await invokeAll([]);
    expect(results).toEqual([]);
  });

  test("timeout is forwarded per-entry", async () => {
    const slowSession = createMockSession(VALID_YAML, {}, { promptDelay: 500 });
    const fastSession = createMockSession(VALID_YAML_PASS);

    const results = await invokeAll([
      { session: slowSession, prompt: "Review", model: "slow-model", timeout: 50 },
      { session: fastSession, prompt: "Review", model: "fast-model" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].verdict).toBe("error");
    expect(results[0].error!.toLowerCase()).toContain("timeout");
    expect(results[1].verdict).toBe("pass");
  });
});
