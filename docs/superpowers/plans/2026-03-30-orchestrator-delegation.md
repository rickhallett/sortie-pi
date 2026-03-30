# Orchestrator Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-agent delegation framework where a human-facing orchestrator dispatches lead and worker sorties via a `delegate` custom tool, with the validation lead as the first concrete implementation.

**Architecture:** A reusable `delegate` Pi custom tool spawns child `AgentSession`s from config-driven agent definitions. The orchestrator is a long-lived session in the Pi terminal. Leads dispatch workers via the same tool. Progress flows up via `sendCustomMessage`. All existing contracts, tools, and pipeline code are preserved.

**Tech Stack:** TypeScript, Pi SDK (`@mariozechner/pi-coding-agent` v0.64.0), `@sinclair/typebox` for tool schemas, `yaml` for config/definition parsing, Bun for runtime and tests.

**Spec:** `docs/superpowers/specs/2026-03-30-orchestrator-delegation-design.md`

---

## File Structure

```
src/orchestrator/
  registry.ts           -- parse .pi/agents/*.md, merge with config, lookup sorties
  registry.test.ts      -- definition parsing, tool resolution, delegation scope
  delegate-tool.ts      -- the delegate custom tool (Pi ToolDefinition)
  delegate-tool.test.ts -- child session lifecycle, parallel exec, scope enforcement
  progress.ts           -- compact progress emission via sendCustomMessage
  progress.test.ts      -- message formatting, custom type verification
  bootstrap.ts          -- load config, build registry, create orchestrator session
  bootstrap.test.ts     -- integration: config -> registry -> session wiring
  index.ts              -- public API export

Modify:
  src/harness/config.ts          -- extend HarnessConfig with sorties section
  src/harness/config.test.ts     -- tests for sorties parsing/validation
  .pi/agents/orchestrator.md     -- updated system prompt for delegation
  .pi/agents/validation-lead.md  -- updated system prompt for protocol steps + delegate
  harness.yaml                   -- add sorties section
```

---

## Phase 1: Config Extension

### Task 1: Extend HarnessConfig with Sorties Section

**Files:**
- Modify: `src/harness/config.ts`
- Modify: `src/harness/config.test.ts`
- Create: `fixtures/sorties/valid-config.yaml`

- [ ] **Step 1: Create a fixture for a valid config with sorties**

Create `fixtures/sorties/valid-config.yaml`:

```yaml
project: sortie-pi
roster:
  - name: claude
    provider: anthropic
    model: claude-sonnet-4-20250514
debrief:
  model: claude-sonnet-4-20250514
  provider: anthropic
  prompt_template: prompts/debrief.md
triage:
  block_on: ["critical", "major"]
modes:
  code:
    prompt_template: prompts/sortie-code.md
sorties:
  orchestrator:
    definition: .pi/agents/orchestrator.md
    tools: [delegate, sortie-triage, sortie-ledger, sortie-identity]
    can_delegate_to: [validation-lead]
  validation-lead:
    definition: .pi/agents/validation-lead.md
    role: lead
    tools: [delegate, sortie-triage, sortie-ledger, sortie-identity, read, grep, find, ls]
    can_delegate_to: [reviewer-claude]
    write_scope: ".sortie/**"
  reviewer-claude:
    definition: .pi/agents/reviewer-claude.md
    role: worker
    tools: [read, write, edit, grep, find, ls]
    can_delegate_to: []
```

- [ ] **Step 2: Write the failing test for sorties config parsing**

In `src/harness/config.test.ts`, add a new describe block:

```typescript
describe("sorties config", () => {
  test("parses sorties section with orchestrator, lead, and worker", () => {
    const config = loadHarnessConfig(join(FIXTURES, "sorties/valid-config.yaml"));
    expect(config.sorties).toBeDefined();
    expect(config.sorties!.orchestrator).toEqual({
      definition: ".pi/agents/orchestrator.md",
      tools: ["delegate", "sortie-triage", "sortie-ledger", "sortie-identity"],
      can_delegate_to: ["validation-lead"],
    });
    expect(config.sorties!["validation-lead"]).toEqual({
      definition: ".pi/agents/validation-lead.md",
      role: "lead",
      tools: ["delegate", "sortie-triage", "sortie-ledger", "sortie-identity", "read", "grep", "find", "ls"],
      can_delegate_to: ["reviewer-claude"],
      write_scope: ".sortie/**",
    });
    expect(config.sorties!["reviewer-claude"]).toEqual({
      definition: ".pi/agents/reviewer-claude.md",
      role: "worker",
      tools: ["read", "write", "edit", "grep", "find", "ls"],
      can_delegate_to: [],
    });
  });

  test("config without sorties section returns undefined sorties", () => {
    const config = loadHarnessConfig(join(FIXTURES, "harness/valid.yaml"));
    expect(config.sorties).toBeUndefined();
  });
});
```

Where `FIXTURES` is the path to the fixtures directory (check existing tests for the pattern — likely `join(import.meta.dir, "../../fixtures")`).

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/harness/config.test.ts --grep "sorties"`
Expected: FAIL — `sorties` property does not exist on HarnessConfig.

- [ ] **Step 4: Add SortieConfig type and extend HarnessConfig**

In `src/harness/config.ts`, add after the existing type definitions:

```typescript
export interface SortieConfig {
  definition: string;
  tools: string[];
  can_delegate_to: string[];
  role?: string;
  write_scope?: string;
}
```

Update `HarnessConfig`:

```typescript
export interface HarnessConfig {
  project: string;
  roster: RosterEntry[];
  debrief: DebriefConfig;
  triage: TriageOverride;
  modes: Record<string, ModeConfig>;
  deposition_dir: string;
  ledger_path: string;
  sorties?: Record<string, SortieConfig>;
}
```

- [ ] **Step 5: Parse sorties in loadHarnessConfig**

In `loadHarnessConfig`, add after the modes parsing block (before the `return` statement):

```typescript
  // --- Optional: Sorties ---
  let sorties: Record<string, SortieConfig> | undefined;
  if (doc.sorties && typeof doc.sorties === "object" && !Array.isArray(doc.sorties)) {
    sorties = {};
    const rawSorties = doc.sorties as Record<string, Record<string, unknown>>;
    for (const [name, s] of Object.entries(rawSorties)) {
      if (!s || typeof s !== "object") throw new Error(`sorties.${name}: must be an object`);
      if (typeof s.definition !== "string" || !s.definition) throw new Error(`sorties.${name}.definition: must be a non-empty string`);
      if (!Array.isArray(s.tools)) throw new Error(`sorties.${name}.tools: must be an array`);
      if (!Array.isArray(s.can_delegate_to)) throw new Error(`sorties.${name}.can_delegate_to: must be an array`);

      const entry: SortieConfig = {
        definition: s.definition as string,
        tools: s.tools as string[],
        can_delegate_to: s.can_delegate_to as string[],
      };
      if (s.role != null) entry.role = s.role as string;
      if (s.write_scope != null) entry.write_scope = s.write_scope as string;
      sorties[name] = entry;
    }
  }
```

Add `sorties` to the return object:

```typescript
  return {
    project: doc.project as string,
    roster,
    debrief,
    triage,
    modes,
    deposition_dir: (doc.deposition_dir as string) ?? ".sortie",
    ledger_path: (doc.ledger_path as string) ?? ".sortie/ledger.yaml",
    ...(sorties ? { sorties } : {}),
  };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/harness/config.test.ts`
Expected: All tests pass including new sorties tests.

- [ ] **Step 7: Commit**

```bash
git add src/harness/config.ts src/harness/config.test.ts fixtures/sorties/valid-config.yaml
git commit -m "feat(config): extend HarnessConfig with optional sorties section"
```

---

## Phase 2: Agent Registry

### Task 2: Agent Registry — Definition Parsing and Lookup

**Files:**
- Create: `src/orchestrator/registry.ts`
- Create: `src/orchestrator/registry.test.ts`
- Create: `fixtures/sorties/test-agent.md`

- [ ] **Step 1: Create a test agent definition fixture**

Create `fixtures/sorties/test-agent.md`:

```markdown
---
name: test-agent
description: Test agent for unit tests.
model: claude-sonnet-4-20250514
tools:
  - read
  - grep
---

You are a test agent. Follow instructions exactly.
```

- [ ] **Step 2: Write failing tests for registry**

Create `src/orchestrator/registry.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  parseAgentDefinition,
  buildRegistry,
  type AgentDefinition,
  type SortieRegistry,
} from "./registry.js";
import type { SortieConfig } from "../harness/config.js";

const FIXTURES = join(import.meta.dir, "../../fixtures");

describe("parseAgentDefinition", () => {
  test("parses frontmatter and body from agent markdown", () => {
    const def = parseAgentDefinition(join(FIXTURES, "sorties/test-agent.md"));
    expect(def.name).toBe("test-agent");
    expect(def.description).toBe("Test agent for unit tests.");
    expect(def.model).toBe("claude-sonnet-4-20250514");
    expect(def.systemPrompt).toContain("You are a test agent");
  });

  test("throws on missing file", () => {
    expect(() => parseAgentDefinition("/nonexistent/agent.md")).toThrow();
  });
});

describe("buildRegistry", () => {
  const sortiesConfig: Record<string, SortieConfig> = {
    "test-lead": {
      definition: "fixtures/sorties/test-agent.md",
      tools: ["delegate", "read"],
      can_delegate_to: ["test-worker"],
    },
    "test-worker": {
      definition: "fixtures/sorties/test-agent.md",
      tools: ["read", "write"],
      can_delegate_to: [],
    },
  };

  test("builds registry from config with resolved definitions", () => {
    const cwd = join(import.meta.dir, "../..");
    const registry = buildRegistry(sortiesConfig, cwd);
    expect(registry.get("test-lead")).toBeDefined();
    expect(registry.get("test-lead")!.config.can_delegate_to).toEqual(["test-worker"]);
    expect(registry.get("test-lead")!.definition.model).toBe("claude-sonnet-4-20250514");
  });

  test("get returns undefined for unknown sortie", () => {
    const cwd = join(import.meta.dir, "../..");
    const registry = buildRegistry(sortiesConfig, cwd);
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  test("canDelegate returns true for allowed delegation", () => {
    const cwd = join(import.meta.dir, "../..");
    const registry = buildRegistry(sortiesConfig, cwd);
    expect(registry.canDelegate("test-lead", "test-worker")).toBe(true);
  });

  test("canDelegate returns false for disallowed delegation", () => {
    const cwd = join(import.meta.dir, "../..");
    const registry = buildRegistry(sortiesConfig, cwd);
    expect(registry.canDelegate("test-worker", "test-lead")).toBe(false);
  });

  test("summary returns human-readable description of available sorties", () => {
    const cwd = join(import.meta.dir, "../..");
    const registry = buildRegistry(sortiesConfig, cwd);
    const summary = registry.summary();
    expect(summary).toContain("test-lead");
    expect(summary).toContain("test-worker");
    expect(summary).toContain("Test agent for unit tests.");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test src/orchestrator/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement registry.ts**

Create `src/orchestrator/registry.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SortieConfig } from "../harness/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
}

export interface RegistryEntry {
  config: SortieConfig;
  definition: AgentDefinition;
}

export interface SortieRegistry {
  get(name: string): RegistryEntry | undefined;
  canDelegate(caller: string, target: string): boolean;
  summary(): string;
  entries(): Array<[string, RegistryEntry]>;
}

// ---------------------------------------------------------------------------
// parseAgentDefinition
// ---------------------------------------------------------------------------

export function parseAgentDefinition(filePath: string): AgentDefinition {
  const content = readFileSync(filePath, "utf-8");
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`Invalid agent definition (missing frontmatter): ${filePath}`);
  }

  const frontmatter = parseYaml(match[1]) as Record<string, unknown>;
  const body = match[2].trim();

  if (typeof frontmatter.name !== "string" || !frontmatter.name) {
    throw new Error(`Agent definition missing 'name': ${filePath}`);
  }
  if (typeof frontmatter.model !== "string" || !frontmatter.model) {
    throw new Error(`Agent definition missing 'model': ${filePath}`);
  }

  return {
    name: frontmatter.name,
    description: (frontmatter.description as string) ?? "",
    model: frontmatter.model,
    systemPrompt: body,
  };
}

// ---------------------------------------------------------------------------
// buildRegistry
// ---------------------------------------------------------------------------

export function buildRegistry(
  sortiesConfig: Record<string, SortieConfig>,
  cwd: string,
): SortieRegistry {
  const map = new Map<string, RegistryEntry>();

  for (const [name, config] of Object.entries(sortiesConfig)) {
    const defPath = join(cwd, config.definition);
    const definition = parseAgentDefinition(defPath);
    map.set(name, { config, definition });
  }

  return {
    get(name: string) {
      return map.get(name);
    },

    canDelegate(caller: string, target: string) {
      const entry = map.get(caller);
      if (!entry) return false;
      return entry.config.can_delegate_to.includes(target);
    },

    summary() {
      const lines: string[] = [];
      for (const [name, entry] of map) {
        const delegates = entry.config.can_delegate_to;
        const delegateStr = delegates.length > 0
          ? ` Can dispatch: ${delegates.join(", ")}.`
          : "";
        lines.push(`- ${name}: ${entry.definition.description}${delegateStr}`);
      }
      return lines.join("\n");
    },

    entries() {
      return [...map.entries()];
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/orchestrator/registry.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/registry.ts src/orchestrator/registry.test.ts fixtures/sorties/
git commit -m "feat(orchestrator): add agent registry with definition parsing and lookup"
```

---

## Phase 3: Progress Reporting

### Task 3: Progress Emission Module

**Files:**
- Create: `src/orchestrator/progress.ts`
- Create: `src/orchestrator/progress.test.ts`

- [ ] **Step 1: Write failing tests for progress**

Create `src/orchestrator/progress.test.ts`:

```typescript
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
    const sendFn = mock(() => {});
    emitProgress(sendFn, "reviewer-claude", "reviewing diff");
    expect(sendFn).toHaveBeenCalledTimes(1);
    const call = sendFn.mock.calls[0][0];
    expect(call.customType).toBe("sortie:progress");
    expect(call.content).toEqual({ sortie: "reviewer-claude", status: "reviewing diff" });
    expect(call.display).toBe("reviewer-claude: reviewing diff");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/orchestrator/progress.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement progress.ts**

Create `src/orchestrator/progress.ts`:

```typescript
// Progress reporting for sortie delegation.
// Emits compact status lines via Pi SDK sendCustomMessage.

export interface ProgressMessage {
  customType: "sortie:progress";
  content: { sortie: string; status: string };
  display: string;
}

export type SendFn = (message: ProgressMessage) => void;

export function formatProgressLine(sortie: string, status: string): string {
  return `${sortie}: ${status}`;
}

export function emitProgress(send: SendFn, sortie: string, status: string): void {
  send({
    customType: "sortie:progress",
    content: { sortie, status },
    display: formatProgressLine(sortie, status),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/orchestrator/progress.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/progress.ts src/orchestrator/progress.test.ts
git commit -m "feat(orchestrator): add progress emission module"
```

---

## Phase 4: Delegate Tool

### Task 4: The `delegate` Custom Tool

This is the core primitive. It spawns a child agent session, prompts it, captures the result, and returns it to the calling agent.

**Files:**
- Create: `src/orchestrator/delegate-tool.ts`
- Create: `src/orchestrator/delegate-tool.test.ts`

- [ ] **Step 1: Write failing tests for delegate tool**

Create `src/orchestrator/delegate-tool.test.ts`:

```typescript
import { describe, expect, mock, test } from "bun:test";
import { createDelegateTool, type DelegateToolDeps } from "./delegate-tool.js";
import { buildRegistry } from "./registry.js";
import type { SortieConfig } from "../harness/config.js";
import { join } from "node:path";

const CWD = join(import.meta.dir, "../..");

const sortiesConfig: Record<string, SortieConfig> = {
  "test-lead": {
    definition: "fixtures/sorties/test-agent.md",
    tools: ["delegate", "read"],
    can_delegate_to: ["test-worker"],
  },
  "test-worker": {
    definition: "fixtures/sorties/test-agent.md",
    tools: ["read", "write"],
    can_delegate_to: [],
  },
};

function makeMockSession(responseText: string) {
  return {
    prompt: mock(async () => {}),
    getLastAssistantText: mock(() => responseText),
    getSessionStats: mock(() => ({
      tokens: { input: 100, output: 50, total: 150 },
      cost: 0.01,
    })),
    dispose: mock(() => {}),
  };
}

function makeDeps(overrides: Partial<DelegateToolDeps> = {}): DelegateToolDeps {
  const session = makeMockSession("task completed successfully");
  return {
    registry: buildRegistry(sortiesConfig, CWD),
    callerName: "test-lead",
    cwd: CWD,
    createSession: mock(async () => ({
      session: session as any,
      dispose: () => session.dispose(),
    })),
    sendProgress: mock(() => {}),
    ...overrides,
  };
}

describe("delegate tool", () => {
  test("executes delegation to an allowed sortie and returns result", async () => {
    const deps = makeDeps();
    const tool = createDelegateTool(deps);
    const result = await tool.execute("call-1", {
      sortie: "test-worker",
      task: "do the thing",
    }, new AbortController().signal, () => {}, {} as any);

    expect(result.content[0].text).toContain("task completed successfully");
    expect(deps.createSession).toHaveBeenCalledTimes(1);
    expect(deps.sendProgress).toHaveBeenCalled();
  });

  test("rejects delegation to a sortie not in can_delegate_to", async () => {
    const deps = makeDeps({ callerName: "test-worker" });
    const tool = createDelegateTool(deps);
    const result = await tool.execute("call-1", {
      sortie: "test-lead",
      task: "do the thing",
    }, new AbortController().signal, () => {}, {} as any);

    expect(result.content[0].text).toContain("not allowed to delegate");
    expect(deps.createSession).not.toHaveBeenCalled();
  });

  test("rejects delegation to an unknown sortie", async () => {
    const deps = makeDeps();
    const tool = createDelegateTool(deps);
    const result = await tool.execute("call-1", {
      sortie: "nonexistent",
      task: "do the thing",
    }, new AbortController().signal, () => {}, {} as any);

    expect(result.content[0].text).toContain("Unknown sortie");
    expect(deps.createSession).not.toHaveBeenCalled();
  });

  test("disposes child session even on error", async () => {
    const disposeFn = mock(() => {});
    const session = makeMockSession("");
    session.prompt = mock(async () => { throw new Error("boom"); });
    const deps = makeDeps({
      createSession: mock(async () => ({
        session: session as any,
        dispose: disposeFn,
      })),
    });
    const tool = createDelegateTool(deps);
    const result = await tool.execute("call-1", {
      sortie: "test-worker",
      task: "do the thing",
    }, new AbortController().signal, () => {}, {} as any);

    expect(result.content[0].text).toContain("boom");
    expect(disposeFn).toHaveBeenCalledTimes(1);
  });

  test("includes context in prompt when provided", async () => {
    const deps = makeDeps();
    const tool = createDelegateTool(deps);
    await tool.execute("call-1", {
      sortie: "test-worker",
      task: "do the thing",
      context: "extra context here",
    }, new AbortController().signal, () => {}, {} as any);

    const promptCall = (deps.createSession as any).mock.results[0].value;
    const session = await promptCall;
    const promptArg = session.session.prompt.mock.calls[0][0];
    expect(promptArg).toContain("extra context here");
    expect(promptArg).toContain("do the thing");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/orchestrator/delegate-tool.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement delegate-tool.ts**

Create `src/orchestrator/delegate-tool.ts`:

```typescript
import { Type } from "@sinclair/typebox";
import type { ToolDefinition, AgentSession } from "@mariozechner/pi-coding-agent";
import type { SortieRegistry } from "./registry.js";
import { emitProgress, type SendFn } from "./progress.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DelegateToolDeps {
  registry: SortieRegistry;
  callerName: string;
  cwd: string;
  createSession: (config: {
    model: string;
    systemPrompt: string;
    tools: string[];
    cwd: string;
    writeScope?: string;
  }) => Promise<{ session: AgentSession; dispose: () => void }>;
  sendProgress: SendFn;
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const DelegateParams = Type.Object({
  sortie: Type.String({ description: "Name of the sortie to delegate to (from config)" }),
  task: Type.String({ description: "Natural language task description for the sortie" }),
  context: Type.Optional(Type.String({ description: "Additional context from the parent agent" })),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDelegateTool(deps: DelegateToolDeps): ToolDefinition<typeof DelegateParams> {
  return {
    name: "delegate",
    label: "Delegate",
    description: "Delegate a task to a sortie (lead or worker agent). The sortie runs in its own session and returns its result.",
    parameters: DelegateParams,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { sortie: sortieName, task, context } = params;

      // --- Validate sortie exists ---
      const entry = deps.registry.get(sortieName);
      if (!entry) {
        return {
          content: [{ type: "text" as const, text: `Error: Unknown sortie: "${sortieName}"` }],
          details: {},
        };
      }

      // --- Validate delegation scope ---
      if (!deps.registry.canDelegate(deps.callerName, sortieName)) {
        return {
          content: [{ type: "text" as const, text: `Error: "${deps.callerName}" is not allowed to delegate to "${sortieName}"` }],
          details: {},
        };
      }

      // --- Create child session ---
      emitProgress(deps.sendProgress, sortieName, "starting...");

      const startTime = Date.now();
      let dispose: () => void = () => {};

      try {
        const { session, dispose: disposeFn } = await deps.createSession({
          model: entry.definition.model,
          systemPrompt: entry.definition.systemPrompt,
          tools: entry.config.tools,
          cwd: deps.cwd,
          writeScope: entry.config.write_scope,
        });
        dispose = disposeFn;

        // --- Build prompt ---
        const prompt = context
          ? `Context:\n${context}\n\nTask:\n${task}`
          : task;

        // --- Execute ---
        emitProgress(deps.sendProgress, sortieName, "working...");
        await session.prompt(prompt);
        const wallTimeMs = Date.now() - startTime;

        const resultText = session.getLastAssistantText() ?? "";
        const stats = session.getSessionStats();

        emitProgress(deps.sendProgress, sortieName, `complete (${wallTimeMs}ms)`);

        // --- Return result ---
        const result = JSON.stringify({
          sortie: sortieName,
          result: resultText,
          tokens: {
            input: stats.tokens?.input ?? 0,
            output: stats.tokens?.output ?? 0,
            total: stats.tokens?.total ?? 0,
          },
          cost: stats.cost ?? 0,
          wall_time_ms: wallTimeMs,
          error: null,
        });

        return {
          content: [{ type: "text" as const, text: result }],
          details: {},
        };
      } catch (err) {
        const wallTimeMs = Date.now() - startTime;
        const message = err instanceof Error ? err.message : String(err);
        emitProgress(deps.sendProgress, sortieName, `error: ${message}`);

        const result = JSON.stringify({
          sortie: sortieName,
          result: "",
          tokens: { input: 0, output: 0, total: 0 },
          cost: 0,
          wall_time_ms: wallTimeMs,
          error: message,
        });

        return {
          content: [{ type: "text" as const, text: result }],
          details: {},
        };
      } finally {
        dispose();
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/orchestrator/delegate-tool.test.ts`
Expected: All tests pass. Adjust the "includes context" test if the prompt-building assertion needs refinement — the key check is that `session.prompt` was called with a string containing both `context` and `task`.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/delegate-tool.ts src/orchestrator/delegate-tool.test.ts
git commit -m "feat(orchestrator): add delegate custom tool"
```

---

## Phase 5: Bootstrap and Public API

### Task 5: Bootstrap — Wire Registry, Delegate Tool, and Orchestrator Session

**Files:**
- Create: `src/orchestrator/bootstrap.ts`
- Create: `src/orchestrator/bootstrap.test.ts`
- Create: `src/orchestrator/index.ts`

- [ ] **Step 1: Write failing tests for bootstrap**

Create `src/orchestrator/bootstrap.test.ts`:

```typescript
import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { buildOrchestratorConfig } from "./bootstrap.js";

function setupWorkspace(): string {
  const tmp = mkdtempSync(join(tmpdir(), "sortie-bootstrap-"));

  // Agent definitions
  mkdirSync(join(tmp, ".pi/agents"), { recursive: true });
  writeFileSync(join(tmp, ".pi/agents/orchestrator.md"), `---
name: orchestrator
description: Test orchestrator.
model: claude-opus
tools: [delegate]
---

You are the orchestrator.
`, "utf-8");

  writeFileSync(join(tmp, ".pi/agents/test-worker.md"), `---
name: test-worker
description: Test worker.
model: claude-sonnet-4-20250514
tools: [read]
---

You are a worker.
`, "utf-8");

  // Prompt templates
  mkdirSync(join(tmp, "prompts"), { recursive: true });
  writeFileSync(join(tmp, "prompts/sortie-code.md"), "review {branch}", "utf-8");
  writeFileSync(join(tmp, "prompts/debrief.md"), "debrief", "utf-8");

  // Config
  writeFileSync(join(tmp, "harness.yaml"), stringify({
    project: "test",
    roster: [{ name: "claude", provider: "anthropic", model: "claude-sonnet-4-20250514" }],
    debrief: { model: "claude-sonnet-4-20250514", provider: "anthropic", prompt_template: "prompts/debrief.md" },
    triage: { block_on: ["critical"] },
    modes: { code: { prompt_template: "prompts/sortie-code.md" } },
    sorties: {
      orchestrator: {
        definition: ".pi/agents/orchestrator.md",
        tools: ["delegate", "sortie-identity"],
        can_delegate_to: ["test-worker"],
      },
      "test-worker": {
        definition: ".pi/agents/test-worker.md",
        role: "worker",
        tools: ["read"],
        can_delegate_to: [],
      },
    },
  }), "utf-8");

  return tmp;
}

describe("buildOrchestratorConfig", () => {
  let tmp = "";

  test("builds orchestrator config with registry, tools, and system prompt", () => {
    tmp = setupWorkspace();
    const config = buildOrchestratorConfig(join(tmp, "harness.yaml"), tmp);

    expect(config.model).toBe("claude-opus");
    expect(config.systemPrompt).toContain("You are the orchestrator");
    expect(config.systemPrompt).toContain("test-worker");
    expect(config.customTools.some((t) => t.name === "delegate")).toBe(true);
    expect(config.registry.get("test-worker")).toBeDefined();

    rmSync(tmp, { recursive: true, force: true });
  });

  test("throws when config has no sorties section", () => {
    tmp = setupWorkspace();
    writeFileSync(join(tmp, "harness.yaml"), stringify({
      project: "test",
      roster: [{ name: "claude", provider: "anthropic", model: "claude-sonnet-4-20250514" }],
      debrief: { model: "claude-sonnet-4-20250514", provider: "anthropic", prompt_template: "prompts/debrief.md" },
      triage: { block_on: ["critical"] },
      modes: { code: { prompt_template: "prompts/sortie-code.md" } },
    }), "utf-8");

    expect(() => buildOrchestratorConfig(join(tmp, "harness.yaml"), tmp)).toThrow("no sorties");

    rmSync(tmp, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/orchestrator/bootstrap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement bootstrap.ts**

Create `src/orchestrator/bootstrap.ts`:

```typescript
import { resolve } from "node:path";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { loadHarnessConfig } from "../harness/config.js";
import { buildRegistry, type SortieRegistry } from "./registry.js";
import { createDelegateTool, type DelegateToolDeps } from "./delegate-tool.js";
import { sortieCustomTools } from "../tools/index.js";
import { emitProgress } from "./progress.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrchestratorConfig {
  model: string;
  systemPrompt: string;
  customTools: ToolDefinition[];
  registry: SortieRegistry;
  cwd: string;
}

// ---------------------------------------------------------------------------
// buildOrchestratorConfig
// ---------------------------------------------------------------------------

export function buildOrchestratorConfig(
  configPath: string,
  cwd: string,
): OrchestratorConfig {
  const config = loadHarnessConfig(resolve(cwd, configPath));

  if (!config.sorties) {
    throw new Error("Config has no sorties section — cannot start orchestrator");
  }

  const registry = buildRegistry(config.sorties, cwd);
  const orchestratorEntry = registry.get("orchestrator");
  if (!orchestratorEntry) {
    throw new Error("Config sorties section has no 'orchestrator' entry");
  }

  // Build system prompt with registry summary
  const registrySummary = registry.summary();
  const systemPrompt = `${orchestratorEntry.definition.systemPrompt}\n\nAvailable sorties:\n${registrySummary}`;

  // Resolve custom tools: delegate + any sortie tools listed in config
  const toolNames = new Set(orchestratorEntry.config.tools);
  const customTools: ToolDefinition[] = [];

  // Add sortie custom tools that are in the orchestrator's tool list
  for (const tool of sortieCustomTools) {
    if (toolNames.has(tool.name)) {
      customTools.push(tool);
    }
  }

  // Delegate tool is added separately — it needs deps wired at session creation time
  // For now, return a placeholder. The actual wiring happens in startOrchestrator.
  if (toolNames.has("delegate")) {
    // Placeholder deps — sendProgress will be wired when the session exists
    const delegateDeps: DelegateToolDeps = {
      registry,
      callerName: "orchestrator",
      cwd,
      createSession: async () => {
        throw new Error("createSession not wired — call startOrchestrator");
      },
      sendProgress: () => {},
    };
    customTools.push(createDelegateTool(delegateDeps) as unknown as ToolDefinition);
  }

  return {
    model: orchestratorEntry.definition.model,
    systemPrompt,
    customTools,
    registry,
    cwd,
  };
}
```

- [ ] **Step 4: Create index.ts public API**

Create `src/orchestrator/index.ts`:

```typescript
export { buildOrchestratorConfig, type OrchestratorConfig } from "./bootstrap.js";
export { buildRegistry, parseAgentDefinition, type SortieRegistry, type AgentDefinition } from "./registry.js";
export { createDelegateTool, type DelegateToolDeps } from "./delegate-tool.js";
export { emitProgress, formatProgressLine } from "./progress.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/orchestrator/bootstrap.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: All existing tests pass plus new orchestrator tests.

- [ ] **Step 7: Commit**

```bash
git add src/orchestrator/
git commit -m "feat(orchestrator): add bootstrap, public API, and module exports"
```

---

## Phase 6: Agent Definition Updates

### Task 6: Update Agent Definitions for Delegation Model

**Files:**
- Modify: `.pi/agents/orchestrator.md`
- Modify: `.pi/agents/validation-lead.md`
- Modify: `harness.yaml`
- Modify: `src/test-support/agent-definitions.test.ts`

- [ ] **Step 1: Update orchestrator.md**

Replace `.pi/agents/orchestrator.md` with:

```markdown
---
name: orchestrator
description: Delegate-only coordinator for Sortie validation runs.
model: claude-opus
tools:
  - delegate
---

You coordinate Sortie work by delegating to lead sorties.

Constraints:
- Delegate-only — use the delegate tool to dispatch work to leads
- Zero writes — do not edit repository files directly
- Do not emit findings directly — leads handle protocol execution

Responsibilities:
- Understand the human's request and decompose it into delegation tasks
- Choose the right lead sortie and mode for each task
- Dispatch leads via the delegate tool (multiple calls execute in parallel)
- Summarize lead results for the human in clear, actionable language
- Handle follow-up questions using conversation context and sortie tools
- Preserve fail-secure behavior — never override a lead's block decision

When delegating validation work, include the branch name, mode, and any
relevant context in the task description.
```

- [ ] **Step 2: Update validation-lead.md**

Replace `.pi/agents/validation-lead.md` with:

```markdown
---
name: validation-lead
description: Lead synthesizer for Sortie verdicts and artifact-safe remediation flow.
model: claude-opus
tools:
  - delegate
  - read
  - grep
  - find
  - ls
  - sortie-triage
  - sortie-ledger
  - sortie-identity
write_scope: .sortie/**
---

You are the Sortie validation lead.

You may assess a delegated task and decline if it is outside your scope or
does not require action. Only proceed with validation work.

When given a validation task, follow these protocol steps in order:

1. Call sortie-identity to compute tree SHA, next cycle, and run ID.
2. Create the run directory at .sortie/{run_id}/attestations/ using file tools.
3. Delegate to reviewer sorties in parallel — one delegate call per reviewer.
   Include the diff and branch name in each reviewer's task.
4. Collect reviewer results from the delegate tool returns.
5. Synthesize a verdict by reasoning over the reviewer outputs:
   - Mark findings as convergent when multiple reviewers flag the same issue.
   - Divergent findings are advisory only.
   - Apply verdict rules: pass (no findings), fail (convergent critical), pass_with_findings.
6. Call sortie-triage with findings and triage config to get the merge decision.
7. Write the verdict, per-reviewer artifacts, and attestations to the run directory.
8. Call sortie-ledger to append the run to the ledger.
9. Return a structured summary including: verdict, findings, exit code, run ID.

Constraints:
- Writes are limited to .sortie/{run_id}/** artifacts
- Use sortie custom tools for protocol-aware operations
- Output strict Sortie YAML for artifacts
- Apply severity definitions consistently
- Block only on justified convergent findings
- If all reviewers error, return an error verdict (fail-secure)
```

- [ ] **Step 3: Add sorties section to harness.yaml**

Add the following to the end of `harness.yaml`:

```yaml

sorties:
  orchestrator:
    definition: .pi/agents/orchestrator.md
    tools: [delegate, sortie-triage, sortie-ledger, sortie-identity]
    can_delegate_to: [validation-lead]
  validation-lead:
    definition: .pi/agents/validation-lead.md
    role: lead
    tools: [delegate, sortie-triage, sortie-ledger, sortie-identity, read, grep, find, ls]
    can_delegate_to: [reviewer-claude, reviewer-gemini, reviewer-codex]
    write_scope: ".sortie/**"
  reviewer-claude:
    definition: .pi/agents/reviewer-claude.md
    role: worker
    tools: [read, write, edit, grep, find, ls]
    can_delegate_to: []
  reviewer-gemini:
    definition: .pi/agents/reviewer-gemini.md
    role: worker
    tools: [read, write, edit, grep, find, ls]
    can_delegate_to: []
  reviewer-codex:
    definition: .pi/agents/reviewer-codex.md
    role: worker
    tools: [read, write, edit, grep, find, ls]
    can_delegate_to: []
```

- [ ] **Step 4: Update agent definition tests**

In `src/test-support/agent-definitions.test.ts`, update the orchestrator test to reflect the new system prompt:

```typescript
  test("orchestrator delegates and does not write", () => {
    const content = readAgent("orchestrator.md");
    expect(content).toContain("Delegate-only");
    expect(content).toContain("Zero writes");
    expect(content).toContain("delegate tool");
  });

  test("validation lead includes protocol steps and may decline tasks", () => {
    const content = readAgent("validation-lead.md");
    expect(content).toContain("sortie-triage");
    expect(content).toContain("sortie-identity");
    expect(content).toContain("decline");
    expect(content).toContain("fail-secure");
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test`
Expected: All tests pass. Agent definition tests reflect the updated prompts.

- [ ] **Step 6: Commit**

```bash
git add .pi/agents/orchestrator.md .pi/agents/validation-lead.md harness.yaml src/test-support/agent-definitions.test.ts
git commit -m "feat(agents): update agent definitions and config for delegation model"
```

---

## Phase 7: Integration Test

### Task 7: Delegation Chain Integration Test

**Files:**
- Create: `src/orchestrator/delegation-chain.test.ts`

- [ ] **Step 1: Write integration test for full delegation chain**

Create `src/orchestrator/delegation-chain.test.ts`:

```typescript
import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { buildOrchestratorConfig } from "./bootstrap.js";
import { createDelegateTool, type DelegateToolDeps } from "./delegate-tool.js";
import { buildRegistry } from "./registry.js";
import type { SortieConfig } from "../harness/config.js";

function setupWorkspace(): { tmp: string; cleanup: () => void } {
  const tmp = mkdtempSync(join(tmpdir(), "sortie-chain-"));

  mkdirSync(join(tmp, ".pi/agents"), { recursive: true });
  mkdirSync(join(tmp, "prompts"), { recursive: true });

  writeFileSync(join(tmp, ".pi/agents/orchestrator.md"), `---
name: orchestrator
description: Test orchestrator.
model: claude-opus
tools: [delegate]
---

You are the orchestrator.
`, "utf-8");

  writeFileSync(join(tmp, ".pi/agents/lead.md"), `---
name: lead
description: Test lead.
model: claude-sonnet-4-20250514
tools: [delegate, read]
---

You are a lead.
`, "utf-8");

  writeFileSync(join(tmp, ".pi/agents/worker.md"), `---
name: worker
description: Test worker.
model: claude-sonnet-4-20250514
tools: [read]
---

You are a worker.
`, "utf-8");

  writeFileSync(join(tmp, "prompts/sortie-code.md"), "review {branch}", "utf-8");
  writeFileSync(join(tmp, "prompts/debrief.md"), "debrief", "utf-8");

  writeFileSync(join(tmp, "harness.yaml"), stringify({
    project: "test",
    roster: [{ name: "claude", provider: "anthropic", model: "claude-sonnet-4-20250514" }],
    debrief: { model: "claude-sonnet-4-20250514", provider: "anthropic", prompt_template: "prompts/debrief.md" },
    triage: { block_on: ["critical"] },
    modes: { code: { prompt_template: "prompts/sortie-code.md" } },
    sorties: {
      orchestrator: {
        definition: ".pi/agents/orchestrator.md",
        tools: ["delegate"],
        can_delegate_to: ["lead"],
      },
      lead: {
        definition: ".pi/agents/lead.md",
        role: "lead",
        tools: ["delegate", "read"],
        can_delegate_to: ["worker"],
      },
      worker: {
        definition: ".pi/agents/worker.md",
        role: "worker",
        tools: ["read"],
        can_delegate_to: [],
      },
    },
  }), "utf-8");

  return { tmp, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

describe("delegation chain", () => {
  test("orchestrator -> lead -> worker chain resolves and disposes all sessions", async () => {
    const { tmp, cleanup } = setupWorkspace();
    const disposeCalls: string[] = [];

    const sortiesConfig: Record<string, SortieConfig> = {
      orchestrator: { definition: ".pi/agents/orchestrator.md", tools: ["delegate"], can_delegate_to: ["lead"] },
      lead: { definition: ".pi/agents/lead.md", role: "lead", tools: ["delegate", "read"], can_delegate_to: ["worker"] },
      worker: { definition: ".pi/agents/worker.md", role: "worker", tools: ["read"], can_delegate_to: [] },
    };

    const registry = buildRegistry(sortiesConfig, tmp);

    // Worker-level delegate tool (shouldn't be needed, workers can't delegate)
    // Lead-level delegate tool
    const leadDeps: DelegateToolDeps = {
      registry,
      callerName: "lead",
      cwd: tmp,
      createSession: mock(async () => ({
        session: {
          prompt: mock(async () => {}),
          getLastAssistantText: mock(() => "worker result"),
          getSessionStats: mock(() => ({ tokens: { input: 10, output: 5, total: 15 }, cost: 0.001 })),
          dispose: mock(() => {}),
        } as any,
        dispose: () => { disposeCalls.push("worker"); },
      })),
      sendProgress: mock(() => {}),
    };
    const leadDelegateTool = createDelegateTool(leadDeps);

    // Orchestrator-level delegate tool
    const orchDeps: DelegateToolDeps = {
      registry,
      callerName: "orchestrator",
      cwd: tmp,
      createSession: mock(async () => ({
        session: {
          prompt: mock(async () => {}),
          getLastAssistantText: mock(() => "lead completed validation"),
          getSessionStats: mock(() => ({ tokens: { input: 50, output: 25, total: 75 }, cost: 0.005 })),
          dispose: mock(() => {}),
        } as any,
        dispose: () => { disposeCalls.push("lead"); },
      })),
      sendProgress: mock(() => {}),
    };
    const orchDelegateTool = createDelegateTool(orchDeps);

    // Orchestrator delegates to lead
    const result = await orchDelegateTool.execute(
      "call-1",
      { sortie: "lead", task: "review feature/auth" },
      new AbortController().signal,
      () => {},
      {} as any,
    );

    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.sortie).toBe("lead");
    expect(parsed.result).toBe("lead completed validation");
    expect(parsed.error).toBeNull();
    expect(disposeCalls).toContain("lead");

    // Lead delegates to worker
    const workerResult = await leadDelegateTool.execute(
      "call-2",
      { sortie: "worker", task: "review diff" },
      new AbortController().signal,
      () => {},
      {} as any,
    );

    const workerParsed = JSON.parse(workerResult.content[0].text as string);
    expect(workerParsed.sortie).toBe("worker");
    expect(workerParsed.result).toBe("worker result");
    expect(disposeCalls).toContain("worker");

    cleanup();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test src/orchestrator/delegation-chain.test.ts`
Expected: PASS — full chain resolves, all sessions dispose.

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator/delegation-chain.test.ts
git commit -m "test(orchestrator): add delegation chain integration test"
```

---

## Phase 8: Documentation

### Task 8: Update CLAUDE.md and Architecture Docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Add orchestrator section to CLAUDE.md architecture**

Add after the `src/cli/` section:

```markdown
### `src/orchestrator/` — Multi-agent delegation framework
- `registry.ts` — parse `.pi/agents/*.md` definitions, build sortie lookup from config
- `delegate-tool.ts` — the `delegate` Pi custom tool: spawns child agent sessions, captures results
- `progress.ts` — compact progress line emission via `sendCustomMessage`
- `bootstrap.ts` — load config, build registry, create orchestrator session with tools
- `index.ts` — public API exports
```

- [ ] **Step 2: Add orchestrator section to docs/architecture.md**

Add a new section after the CLI section describing the orchestrator layer and its dependency on harness + tools.

- [ ] **Step 3: Update the dependency direction in both docs**

Update the dependency graph to:

```
contracts -> harness -> tools -> orchestrator
                                      |
                                validation (pipeline.ts — CI path)
                                      |
                                     cli
```

- [ ] **Step 4: Run full test suite one final time**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/architecture.md
git commit -m "docs: add orchestrator delegation framework to architecture docs"
```
