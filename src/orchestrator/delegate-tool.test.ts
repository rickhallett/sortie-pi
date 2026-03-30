// Delegate tool tests — TDD red phase

import { describe, test, expect, mock } from "bun:test";
import { join } from "node:path";
import { buildRegistry } from "./registry.js";
import type { SortieConfig } from "../harness/config.js";
import { createDelegateTool, type DelegateToolDeps } from "./delegate-tool.js";
import type { ProgressMessage } from "./progress.js";

const CWD = join(import.meta.dir, "../..");

/** Extract text from the first content block of a tool result. */
function textOf(result: { content: { type: string; text?: string }[] }): string {
  const block = result.content[0];
  if (block.type !== "text" || typeof block.text !== "string") {
    throw new Error("Expected text content block");
  }
  return block.text;
}

const sortiesConfig: Record<string, SortieConfig> = {
  "test-lead": {
    definition: "fixtures/sorties/test-agent.md",
    tools: ["read", "grep"],
    can_delegate_to: ["test-worker"],
  },
  "test-worker": {
    definition: "fixtures/sorties/test-agent.md",
    tools: ["read"],
    can_delegate_to: [],
  },
};

function makeMockSession(responseText: string) {
  return {
    prompt: mock(async (_text: string) => {}),
    getLastAssistantText: mock(() => responseText),
    getSessionStats: mock(() => ({
      sessionFile: undefined,
      sessionId: "mock-session",
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 2,
      tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
      cost: 0.001,
    })),
    dispose: mock(() => {}),
  };
}

function makeDeps(overrides: Partial<DelegateToolDeps> = {}): DelegateToolDeps {
  const mockSession = makeMockSession("mock response");
  return {
    registry: buildRegistry(sortiesConfig, CWD),
    callerName: "test-lead",
    cwd: CWD,
    createSession: mock(async () => ({
      session: mockSession as any,
      dispose: mockSession.dispose,
    })),
    sendProgress: mock((_msg: ProgressMessage) => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createDelegateTool", () => {
  test("executes delegation to an allowed sortie and returns result", async () => {
    const sessionMock = makeMockSession("worker completed the task");
    const deps = makeDeps({
      createSession: mock(async () => ({
        session: sessionMock as any,
        dispose: sessionMock.dispose,
      })),
    });

    const tool = createDelegateTool(deps);
    const result = await tool.execute(
      "call-1",
      { sortie: "test-worker", task: "do the thing" },
      undefined,
      undefined,
      {} as any,
    );

    // Result should contain the response text
    const text = textOf(result);
    expect(text).toContain("worker completed the task");

    // createSession should have been called
    expect(deps.createSession).toHaveBeenCalled();

    // sendProgress should have been called
    expect(deps.sendProgress).toHaveBeenCalled();
  });

  test("rejects delegation to a sortie not in can_delegate_to", async () => {
    const deps = makeDeps({ callerName: "test-worker" });

    const tool = createDelegateTool(deps);
    const result = await tool.execute(
      "call-2",
      { sortie: "test-lead", task: "try to delegate up" },
      undefined,
      undefined,
      {} as any,
    );

    const text = textOf(result);
    expect(text).toContain("not allowed");

    // createSession should NOT have been called
    expect(deps.createSession).not.toHaveBeenCalled();
  });

  test("rejects delegation to an unknown sortie", async () => {
    const deps = makeDeps();

    const tool = createDelegateTool(deps);
    const result = await tool.execute(
      "call-3",
      { sortie: "nonexistent", task: "impossible task" },
      undefined,
      undefined,
      {} as any,
    );

    const text = textOf(result);
    expect(text).toContain("error");

    // createSession should NOT have been called
    expect(deps.createSession).not.toHaveBeenCalled();
  });

  test("disposes child session even on error", async () => {
    const sessionMock = makeMockSession("unused");
    sessionMock.prompt = mock(async () => {
      throw new Error("prompt exploded");
    });

    const deps = makeDeps({
      createSession: mock(async () => ({
        session: sessionMock as any,
        dispose: sessionMock.dispose,
      })),
    });

    const tool = createDelegateTool(deps);
    const result = await tool.execute(
      "call-4",
      { sortie: "test-worker", task: "fail task" },
      undefined,
      undefined,
      {} as any,
    );

    // Should still have disposed
    expect(sessionMock.dispose).toHaveBeenCalled();

    // Result should contain error info
    const text = textOf(result);
    expect(text).toContain("error");
    expect(text).toContain("prompt exploded");
  });

  test("includes context in prompt when provided", async () => {
    const sessionMock = makeMockSession("contextual response");
    const deps = makeDeps({
      createSession: mock(async () => ({
        session: sessionMock as any,
        dispose: sessionMock.dispose,
      })),
    });

    const tool = createDelegateTool(deps);
    await tool.execute(
      "call-5",
      {
        sortie: "test-worker",
        task: "do the thing",
        context: "here is some extra context",
      },
      undefined,
      undefined,
      {} as any,
    );

    // The prompt sent to the session should contain both context and task
    const promptCall = sessionMock.prompt.mock.calls[0];
    const promptText = promptCall[0] as string;
    expect(promptText).toContain("here is some extra context");
    expect(promptText).toContain("do the thing");
  });
});
