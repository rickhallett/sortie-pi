// Delegation chain integration test — orchestrator -> lead -> worker

import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mock } from "bun:test";
import { buildRegistry } from "./registry.js";
import { createDelegateTool, type DelegateToolDeps } from "./delegate-tool.js";
import type { SortieConfig } from "../harness/config.js";
import type { ProgressMessage } from "./progress.js";

// ---------------------------------------------------------------------------
// Workspace setup
// ---------------------------------------------------------------------------

async function setupWorkspace(): Promise<{ tmp: string; cleanup: () => Promise<void> }> {
  const tmp = await mkdtemp(join(tmpdir(), "delegation-chain-test-"));

  // .pi/agents/orchestrator.md
  await mkdir(join(tmp, ".pi", "agents"), { recursive: true });
  await writeFile(
    join(tmp, ".pi", "agents", "orchestrator.md"),
    [
      "---",
      "name: orchestrator",
      "description: Main orchestrator agent.",
      "model: claude-opus",
      "---",
      "",
      "You are the orchestrator. Coordinate all validation work.",
    ].join("\n"),
    "utf-8",
  );

  // .pi/agents/lead.md
  await writeFile(
    join(tmp, ".pi", "agents", "lead.md"),
    [
      "---",
      "name: lead",
      "description: Lead validation agent.",
      "model: claude-sonnet",
      "---",
      "",
      "You are the lead. Run validation and delegate to workers.",
    ].join("\n"),
    "utf-8",
  );

  // .pi/agents/worker.md
  await writeFile(
    join(tmp, ".pi", "agents", "worker.md"),
    [
      "---",
      "name: worker",
      "description: Worker validation agent.",
      "model: claude-haiku",
      "---",
      "",
      "You are a worker. Perform assigned validation tasks.",
    ].join("\n"),
    "utf-8",
  );

  // prompts/
  await mkdir(join(tmp, "prompts"), { recursive: true });
  await writeFile(join(tmp, "prompts", "sortie-code.md"), "Review code.", "utf-8");
  await writeFile(join(tmp, "prompts", "debrief.md"), "Synthesize findings.", "utf-8");

  // harness.yaml with sorties section: orchestrator -> lead -> worker
  const harnessYaml = [
    "project: test-project",
    "roster:",
    "  - name: claude",
    "    provider: anthropic",
    "    model: claude-sonnet-4-20250514",
    "debrief:",
    "  model: claude-sonnet-4-20250514",
    "  provider: anthropic",
    "  prompt_template: prompts/debrief.md",
    "triage:",
    "  block_on: [critical, major]",
    "modes:",
    "  code:",
    "    prompt_template: prompts/sortie-code.md",
    "sorties:",
    "  orchestrator:",
    "    definition: .pi/agents/orchestrator.md",
    "    tools: [sortie-delegate]",
    "    can_delegate_to: [lead]",
    "  lead:",
    "    definition: .pi/agents/lead.md",
    "    tools: [sortie-delegate]",
    "    can_delegate_to: [worker]",
    "  worker:",
    "    definition: .pi/agents/worker.md",
    "    tools: []",
    "    can_delegate_to: []",
  ].join("\n");
  await writeFile(join(tmp, "harness.yaml"), harnessYaml, "utf-8");

  return {
    tmp,
    cleanup: () => rm(tmp, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// Mock session helper
// ---------------------------------------------------------------------------

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
  };
}

// ---------------------------------------------------------------------------
// Integration test
// ---------------------------------------------------------------------------

describe("delegation chain", () => {
  test("orchestrator -> lead -> worker chain resolves and disposes all sessions", async () => {
    const { tmp, cleanup } = await setupWorkspace();

    try {
      // Sorties config mirrors harness.yaml sorties section
      const sortiesConfig: Record<string, SortieConfig> = {
        orchestrator: {
          definition: ".pi/agents/orchestrator.md",
          tools: ["sortie-delegate"],
          can_delegate_to: ["lead"],
        },
        lead: {
          definition: ".pi/agents/lead.md",
          tools: ["sortie-delegate"],
          can_delegate_to: ["worker"],
        },
        worker: {
          definition: ".pi/agents/worker.md",
          tools: [],
          can_delegate_to: [],
        },
      };

      // Build registry from the sorties config
      const registry = buildRegistry(sortiesConfig, tmp);

      // Track all dispose calls
      const disposeCalls: string[] = [];

      // --- Lead-level delegate tool ---
      // Mock session: worker responds "worker result"
      const workerSession = makeMockSession("worker result");
      const leadCreateSession: DelegateToolDeps["createSession"] = mock(async () => {
        const disposeWorker = mock(() => {
          disposeCalls.push("worker");
        });
        return {
          session: workerSession as any,
          dispose: disposeWorker,
        };
      });

      const leadDelegateTool = createDelegateTool({
        registry,
        callerName: "lead",
        cwd: tmp,
        createSession: leadCreateSession,
        sendProgress: mock((_msg: ProgressMessage) => {}),
      });

      // --- Orchestrator-level delegate tool ---
      // Mock session: lead responds "lead completed validation"
      const leadSession = makeMockSession("lead completed validation");
      const orchestratorCreateSession: DelegateToolDeps["createSession"] = mock(async () => {
        const disposeLead = mock(() => {
          disposeCalls.push("lead");
        });
        return {
          session: leadSession as any,
          dispose: disposeLead,
        };
      });

      const orchestratorDelegateTool = createDelegateTool({
        registry,
        callerName: "orchestrator",
        cwd: tmp,
        createSession: orchestratorCreateSession,
        sendProgress: mock((_msg: ProgressMessage) => {}),
      });

      // Step 1: orchestrator delegates to lead
      const orchestratorResult = await orchestratorDelegateTool.execute(
        "call-orch-1",
        { sortie: "lead", task: "review feature/auth" },
        new AbortController().signal,
        () => {},
        {} as any,
      );

      const orchestratorText = orchestratorResult.content[0];
      expect(orchestratorText.type).toBe("text");
      const orchestratorData = JSON.parse((orchestratorText as { type: string; text: string }).text);
      expect(orchestratorData.result).toContain("lead completed validation");
      expect(orchestratorData.error).toBeNull();

      // Lead session should have been disposed
      expect(disposeCalls).toContain("lead");

      // Step 2: lead delegates to worker
      const leadResult = await leadDelegateTool.execute(
        "call-lead-1",
        { sortie: "worker", task: "review feature/auth" },
        new AbortController().signal,
        () => {},
        {} as any,
      );

      const leadText = leadResult.content[0];
      expect(leadText.type).toBe("text");
      const leadData = JSON.parse((leadText as { type: string; text: string }).text);
      expect(leadData.result).toContain("worker result");
      expect(leadData.error).toBeNull();

      // Worker session should now also have been disposed
      expect(disposeCalls).toContain("worker");
    } finally {
      await cleanup();
    }
  });
});
