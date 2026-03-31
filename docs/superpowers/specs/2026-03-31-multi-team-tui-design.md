# Multi-Team TUI Design

**Date:** 2026-03-31
**Status:** Approved
**Vector:** Multi-team UX for sortie-pi orchestrator

## Summary

Add a live TUI to the sortie-pi orchestrator that renders the full delegation tree with real-time status, cost/token tracking, and agent conversation messages. Ship with a multi-team demo config (Planning, Engineering, Validation). The TUI is generic — it renders any `sorties` configuration defined in `harness.yaml` by inferring tree structure from `can_delegate_to` at runtime.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Config structure | Flat `sorties` map with `can_delegate_to` | Tree inferred at runtime; no config schema changes needed |
| State management | Centralized `DelegationTracker` | Single source of truth; testable without TUI; renderer is a pure view |
| TUI rendering | Pi SDK native (`sendCustomMessage` + `MessageRenderer` + `@mariozechner/pi-tui`) | Renders inside the Pi harness natively; matches the demo screenshots |
| Parallel delegation | LLM-driven via Pi SDK parallel tool calls | No new tools; orchestrator naturally calls `delegate` multiple times in one turn |
| Conversation display | All agent messages shown | Orchestrator, leads, and workers all appear with labeled messages |
| Tree depth | Configurable (`displayDepth` option, default unlimited) | Full tree by default; collapsible for dense configs |
| Demo config | Multi-team is the new default `harness.yaml` | Old validation-only config preserved as `harness-validation.yaml` |

## 1. DelegationTracker

A plain TypeScript class in `src/orchestrator/tracker.ts`. No Pi SDK imports. Holds the full delegation tree as a flat map of nodes keyed by generated delegation IDs.

### Node Structure

```typescript
interface DelegationNode {
  id: string;               // unique, e.g. "d-001"
  sortieName: string;       // "validation-lead", "reviewer-claude", etc.
  parentId: string | null;  // null for orchestrator root
  model: string;            // from agent definition
  status: "pending" | "running" | "complete" | "error";
  tokens: { input: number; output: number; total: number };
  cost: number;
  startedAt: number;        // Date.now()
  completedAt: number | null;
  error: string | null;
}
```

### Tracker API

```typescript
class DelegationTracker {
  addNode(sortieName: string, parentId: string | null, model: string): string;
  markRunning(id: string): void;
  markComplete(id: string, tokens: { input: number; output: number; total: number }, cost: number): void;
  markError(id: string, error: string): void;
  getTree(): DelegationNode[];  // root nodes with children resolvable via parentId
  getNode(id: string): DelegationNode | undefined;
  getChildren(id: string): DelegationNode[];
  getAggregatedCost(id: string): number;  // node cost + all descendant costs
  on(event: "update", callback: () => void): void;
  off(event: "update", callback: () => void): void;
}
```

Emits `"update"` on every state mutation so the renderer knows to redraw.

## 2. Event Propagation

The tracker is threaded through the delegation chain via `DelegateToolDeps`.

### Modified DelegateToolDeps

```typescript
interface DelegateToolDeps {
  registry: SortieRegistry;
  callerName: string;
  callerNodeId: string;        // NEW — tracker node ID of the caller
  cwd: string;
  tracker: DelegationTracker;  // NEW — shared tracker instance
  createSession: (config) => Promise<{ session; dispose }>;
  sendProgress: SendFn;
}
```

### Delegation Lifecycle

1. `tracker.addNode(sortieName, callerNodeId, model)` — before session creation
2. `tracker.markRunning(nodeId)` — session starts
3. `tracker.markComplete(nodeId, tokens, cost)` — child completes
4. `tracker.markError(nodeId, error)` — child fails

### Recursive Delegation

When a lead delegates to a worker, the lead's delegate tool receives `callerNodeId` set to the lead's own node ID. Every `addNode` includes `parentId`, so the tracker naturally builds the full tree.

### Parallel Tool Calls

No special handling. Pi SDK calls `execute()` concurrently. Each call gets its own node ID. The tracker is synchronous (single-threaded JS), so concurrent mutations are safe.

The orchestrator root node is created in `startOrchestrator` before the session begins, with `parentId: null`.

## 3. Conversation Message Capture

Child session assistant text is emitted to the parent session via `sendCustomMessage` so all agents' messages appear in the conversation pane.

### Custom Message Type: `sortie:message`

```typescript
interface AgentMessage {
  customType: "sortie:message";
  content: {
    nodeId: string;
    sortieName: string;
    text: string;
    role: "assistant";
  };
  display: string;  // formatted: "[Validation Lead] Let me read..."
}
```

### Capture Point

In the delegate tool, after `session.prompt()` returns and `getLastAssistantText()` captures the response. The delegate tool emits `sortie:message` via the parent session's `sendCustomMessage`.

For nested delegations (lead -> worker), the worker's message bubbles up through the lead's session to the orchestrator's session.

Only final assistant text is captured per delegation — intermediate tool calls (file reads, greps) are not surfaced. This keeps the conversation pane readable.

## 4. MessageRenderer — TUI Components

Registered as Pi SDK `MessageRenderer` instances in the orchestrator bootstrap.

### Status Tree Renderer (`sortie:progress`)

Queries `tracker.getTree()` and formats using box-drawing characters:

```
prompt-routing | mn7p6kx0myw2 | 6m 31s
└─ * Orch  $2.207  1040K claude-opus-4-6
   ├─ + Planning Lead  $0.750  1030K claude-opus-4-6
   │  ├─ + Product Manager  $0.418  1003K claude-sonnet-4-6
   │  └─ + UX Researcher  $0.111  1030K claude-sonnet-4-6
   ├─ * Engineering Lead  $0.847  1032K claude-opus-4-6
   │  ├─ * Frontend Dev  $0.185  1013K claude-sonnet-4-6
   │  └─ + Backend Dev  $0.381  1007K claude-sonnet-4-6
   └─ + Validation Lead  $0.443  1037K claude-opus-4-6
      ├─ + QA Engineer  $0.159  1025K claude-sonnet-4-6
      └─ + Security Reviewer  $0.134  1027K claude-sonnet-4-6
```

**Status indicators:** `o` pending, `*` running, `+` complete, `x` error. Plain ASCII.

**Per-node display:** `{indicator} {name}  ${cost}  {tokens}K {model}`

**Configurable depth:** `displayDepth` option (default: unlimited). Nodes beyond the depth are collapsed; their costs aggregate into the parent.

**Redraw:** Tracker emits `"update"` events. Renderer calls `component.invalidate()` to trigger Pi TUI re-render.

Uses `@mariozechner/pi-tui` `Text` component for rendering.

### Conversation Message Renderer (`sortie:message`)

Renders agent responses with a colored initial + name label:

```
P  Planning Lead                              11:45 AM
     Let me read my skills and context files first.

E  Engineering Lead                           11:45 AM
     Pong. Engineering team is online.
```

## 5. Multi-Team Demo Config

The new default `harness.yaml` defines three teams. The old validation-only config is preserved as `harness-validation.yaml`.

### Agent Roster

| Agent | Model | Role | Delegates to |
|-------|-------|------|-------------|
| orchestrator | claude-opus-4-6 | — | planning-lead, engineering-lead, validation-lead |
| planning-lead | claude-opus-4-6 | lead | product-manager, ux-researcher |
| product-manager | claude-sonnet-4-20250514 | worker | — |
| ux-researcher | claude-sonnet-4-20250514 | worker | — |
| engineering-lead | claude-opus-4-6 | lead | frontend-dev, backend-dev |
| frontend-dev | claude-sonnet-4-20250514 | worker | — |
| backend-dev | claude-sonnet-4-20250514 | worker | — |
| validation-lead | claude-opus-4-6 | lead | qa-engineer, security-reviewer |
| qa-engineer | claude-sonnet-4-20250514 | worker | — |
| security-reviewer | claude-sonnet-4-20250514 | worker | — |

Each agent gets a focused system prompt defining its specialty. Leads know how to decompose work and delegate. Workers perform their specific task and return structured output.

## 6. Testing Strategy

### Tracker Tests (`src/orchestrator/tracker.test.ts`)

- Node lifecycle: add -> running -> complete/error
- Tree structure: parent-child relationships, multi-level nesting
- Aggregated cost: sums descendant costs correctly
- Event emission: `"update"` fires on every state change
- Edge cases: unknown node ID, duplicate add, complete a pending node

### Renderer Tests (`src/orchestrator/renderer.test.ts`)

- Tree formatting: correct box-drawing characters for various topologies
- Status indicators: `o`, `*`, `+`, `x` map correctly
- Configurable depth: nodes beyond depth collapsed, costs aggregated
- Empty tree: renders gracefully
- Pure output tests — renderer takes tracker state, returns string lines

### Delegate Tool Integration (extend `src/orchestrator/delegate-tool.test.ts`)

- Tracker receives correct `addNode`/`markRunning`/`markComplete` calls
- `callerNodeId` propagates correctly through nested delegations
- Parallel delegations create separate nodes with same parent
- Error delegation calls `markError`

### Message Capture Tests

- `sortie:message` emitted with correct sortieName and text
- Nested messages bubble up through delegation chain

### Demo Config Structural Tests (extend `src/test-support/agent-definitions.test.ts`)

- All agent definition files parse correctly
- `can_delegate_to` graph has no cycles
- Every delegation target exists in the sorties map

## 7. File Layout

### New Files

```
src/orchestrator/tracker.ts          — DelegationTracker class
src/orchestrator/tracker.test.ts     — Tracker unit tests
src/orchestrator/renderer.ts         — Tree + message MessageRenderers
src/orchestrator/renderer.test.ts    — Renderer unit tests
.pi/agents/planning-lead.md          — Planning team lead
.pi/agents/product-manager.md        — Planning worker
.pi/agents/ux-researcher.md          — Planning worker
.pi/agents/engineering-lead.md       — Engineering team lead
.pi/agents/frontend-dev.md           — Engineering worker
.pi/agents/backend-dev.md            — Engineering worker
.pi/agents/qa-engineer.md            — Validation worker
.pi/agents/security-reviewer.md      — Validation worker
harness-validation.yaml              — Old harness.yaml (validation-only)
```

### Modified Files

```
src/orchestrator/delegate-tool.ts    — Add tracker calls, callerNodeId in deps
src/orchestrator/bootstrap.ts        — Create tracker, wire through deps, register renderers
src/orchestrator/progress.ts         — Wire sendProgress to sendCustomMessage
src/cli/orchestrate.ts               — Pass displayDepth option
harness.yaml                         — Multi-team demo config
.pi/agents/orchestrator.md           — Updated can_delegate_to for 3 teams
.pi/agents/validation-lead.md        — Updated delegates
```

### Removed Files

```
.pi/agents/reviewer-claude.md        — Replaced by team workers
.pi/agents/reviewer-gemini.md        — Replaced by team workers
.pi/agents/reviewer-codex.md         — Replaced by team workers
```
