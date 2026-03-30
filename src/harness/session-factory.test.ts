// Session factory tests — SORTIE_PROTOCOL_v3.md Section 16
// Written FIRST (TDD red phase)

import { describe, test, expect } from "bun:test";
import {
  resolveModel,
  buildReviewerSessionConfig,
  buildLeadSessionConfig,
} from "./session-factory.js";
import type { RosterEntry, DebriefConfig } from "./config.js";
import type { SessionOptions } from "./session-factory.js";
import {
  readOnlyTools,
  codingTools,
  SessionManager,
} from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REVIEWER_ENTRY: RosterEntry = {
  name: "claude-sonnet",
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  timeout: 120_000,
};

const DEBRIEF_CONFIG: DebriefConfig = {
  model: "claude-sonnet-4-20250514",
  provider: "anthropic",
  prompt_template: "prompts/debrief.md",
};

const SESSION_OPTIONS: SessionOptions = {
  cwd: "/tmp/test-project",
};

// A minimal custom tool definition for testing lead sessions
const CUSTOM_TOOL = {
  name: "sortie_write_deposition",
  description: "Write a deposition file",
  parameters: {
    type: "object" as const,
    properties: {
      path: { type: "string" as const },
      content: { type: "string" as const },
    },
    required: ["path", "content"],
  },
  execute: async () => ({ content: "ok" }),
};

// ---------------------------------------------------------------------------
// resolveModel
// ---------------------------------------------------------------------------

describe("resolveModel", () => {
  test("returns a model object for anthropic / claude-sonnet-4-20250514", () => {
    const model = resolveModel("anthropic", "claude-sonnet-4-20250514");
    expect(model).toBeDefined();
    expect(model.id).toBe("claude-sonnet-4-20250514");
    expect(model.provider).toBe("anthropic");
  });

  test("returned model has expected structural fields", () => {
    const model = resolveModel("anthropic", "claude-sonnet-4-20250514");
    expect(typeof model.name).toBe("string");
    expect(typeof model.api).toBe("string");
    expect(typeof model.baseUrl).toBe("string");
    expect(typeof model.contextWindow).toBe("number");
    expect(typeof model.maxTokens).toBe("number");
  });

  test("throws for unknown provider", () => {
    expect(() => resolveModel("nonexistent-provider", "some-model")).toThrow();
  });

  test("throws for unknown model on valid provider", () => {
    expect(() => resolveModel("anthropic", "nonexistent-model-xyz")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildReviewerSessionConfig
// ---------------------------------------------------------------------------

describe("buildReviewerSessionConfig", () => {
  test("includes readOnlyTools", () => {
    const config = buildReviewerSessionConfig(REVIEWER_ENTRY, SESSION_OPTIONS);
    expect(config.tools).toBe(readOnlyTools);
  });

  test("uses SessionManager.inMemory()", () => {
    const config = buildReviewerSessionConfig(REVIEWER_ENTRY, SESSION_OPTIONS);
    expect(config.sessionManager).toBeDefined();
    // SessionManager.inMemory() returns a SessionManager instance
    expect(config.sessionManager).toBeInstanceOf(SessionManager);
  });

  test("resolves correct model for entry", () => {
    const config = buildReviewerSessionConfig(REVIEWER_ENTRY, SESSION_OPTIONS);
    expect(config.model).toBeDefined();
    expect(config.model!.id).toBe("claude-sonnet-4-20250514");
    expect(config.model!.provider).toBe("anthropic");
  });

  test("sets cwd from options", () => {
    const config = buildReviewerSessionConfig(REVIEWER_ENTRY, SESSION_OPTIONS);
    expect(config.cwd).toBe("/tmp/test-project");
  });

  test("does not include customTools", () => {
    const config = buildReviewerSessionConfig(REVIEWER_ENTRY, SESSION_OPTIONS);
    expect(config.customTools).toBeUndefined();
  });

  test("does not include coding-only tools (bash, edit, write)", () => {
    const config = buildReviewerSessionConfig(REVIEWER_ENTRY, SESSION_OPTIONS);
    const toolNames = config.tools!.map((t: { name: string }) => t.name);
    expect(toolNames).not.toContain("bash");
    expect(toolNames).not.toContain("edit");
    expect(toolNames).not.toContain("write");
  });

  test("includes read-only tools (read, grep, find, ls)", () => {
    const config = buildReviewerSessionConfig(REVIEWER_ENTRY, SESSION_OPTIONS);
    const toolNames = config.tools!.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).toContain("grep");
    expect(toolNames).toContain("find");
    expect(toolNames).toContain("ls");
  });
});

// ---------------------------------------------------------------------------
// buildLeadSessionConfig
// ---------------------------------------------------------------------------

describe("buildLeadSessionConfig", () => {
  test("includes codingTools", () => {
    const config = buildLeadSessionConfig(DEBRIEF_CONFIG, SESSION_OPTIONS);
    expect(config.tools).toBe(codingTools);
  });

  test("uses SessionManager.inMemory()", () => {
    const config = buildLeadSessionConfig(DEBRIEF_CONFIG, SESSION_OPTIONS);
    expect(config.sessionManager).toBeDefined();
    expect(config.sessionManager).toBeInstanceOf(SessionManager);
  });

  test("resolves correct model for debrief config", () => {
    const config = buildLeadSessionConfig(DEBRIEF_CONFIG, SESSION_OPTIONS);
    expect(config.model).toBeDefined();
    expect(config.model!.id).toBe("claude-sonnet-4-20250514");
    expect(config.model!.provider).toBe("anthropic");
  });

  test("sets cwd from options", () => {
    const config = buildLeadSessionConfig(DEBRIEF_CONFIG, SESSION_OPTIONS);
    expect(config.cwd).toBe("/tmp/test-project");
  });

  test("includes custom tools when provided", () => {
    const opts: SessionOptions = {
      cwd: "/tmp/test-project",
      customTools: [CUSTOM_TOOL as any],
    };
    const config = buildLeadSessionConfig(DEBRIEF_CONFIG, opts);
    expect(config.customTools).toBeDefined();
    expect(config.customTools).toHaveLength(1);
    expect(config.customTools![0].name).toBe("sortie_write_deposition");
  });

  test("omits customTools when none provided", () => {
    const config = buildLeadSessionConfig(DEBRIEF_CONFIG, SESSION_OPTIONS);
    expect(config.customTools).toBeUndefined();
  });

  test("includes coding tools (read, bash, edit, write)", () => {
    const config = buildLeadSessionConfig(DEBRIEF_CONFIG, SESSION_OPTIONS);
    const toolNames = config.tools!.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).toContain("bash");
    expect(toolNames).toContain("edit");
    expect(toolNames).toContain("write");
  });
});
