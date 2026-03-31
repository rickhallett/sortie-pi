# Multi-Team TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live delegation tree TUI, wire progress through the delegation chain, and ship a multi-team demo config.

**Architecture:** Centralized `DelegationTracker` holds tree state; pure `renderTree` formatter produces output; tracker is threaded through `DelegateToolDeps`; Pi SDK `sendCustomMessage` + `MessageRenderer` drives display. Demo config defines 3 teams (Planning, Engineering, Validation) with 10 agents total.

**Tech Stack:** TypeScript, Bun, Pi SDK (`@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`), `@sinclair/typebox`

---

### Task 1: DelegationTracker — Core Node Management

**Files:**
- Create: `src/orchestrator/tracker.ts`
- Create: `src/orchestrator/tracker.test.ts`

- [ ] **Step 1: Write failing tests for node lifecycle**

```typescript
// src/orchestrator/tracker.test.ts
import { describe, test, expect } from "bun:test";
import { DelegationTracker } from "./tracker.js";

describe("DelegationTracker", () => {
  describe("addNode", () => {
    test("returns a unique node ID", () => {
      const tracker = new DelegationTracker();
      const id1 = tracker.addNode("orch", null, "claude-opus-4-6");
      const id2 = tracker.addNode("lead", id1, "claude-opus-4-6");
      expect(id1).not.toBe(id2);
    });

    test("stores node with pending status and zero metrics", () => {
      const tracker = new DelegationTracker();
      const id = tracker.addNode("orch", null, "claude-opus-4-6");
      const node = tracker.getNode(id);
      expect(node).toBeDefined();
      expect(node!.sortieName).toBe("orch");
      expect(node!.parentId).toBeNull();
      expect(node!.model).toBe("claude-opus-4-6");
      expect(node!.status).toBe("pending");
      expect(node!.tokens).toEqual({ input: 0, output: 0, total: 0 });
      expect(node!.cost).toBe(0);
      expect(node!.completedAt).toBeNull();
      expect(node!.error).toBeNull();
    });

    test("records startedAt timestamp", () => {
      const tracker = new DelegationTracker();
      const before = Date.now();
      const id = tracker.addNode("orch", null, "claude-opus-4-6");
      const after = Date.now();
      const node = tracker.getNode(id)!;
      expect(node.startedAt).toBeGreaterThanOrEqual(before);
      expect(node.startedAt).toBeLessThanOrEqual(after);
    });
  });

  describe("markRunning", () => {
    test("transitions node from pending to running", () => {
      const tracker = new DelegationTracker();
      const id = tracker.addNode("orch", null, "claude-opus-4-6");
      tracker.markRunning(id);
      expect(tracker.getNode(id)!.status).toBe("running");
    });

    test("throws for unknown node ID", () => {
      const tracker = new DelegationTracker();
      expect(() => tracker.markRunning("nonexistent")).toThrow();
    });
  });

  describe("markComplete", () => {
    test("transitions node to complete with metrics", () => {
      const tracker = new DelegationTracker();
      const id = tracker.addNode("orch", null, "claude-opus-4-6");
      tracker.markRunning(id);
      tracker.markComplete(id, { input: 100, output: 50, total: 150 }, 0.005);
      const node = tracker.getNode(id)!;
      expect(node.status).toBe("complete");
      expect(node.tokens).toEqual({ input: 100, output: 50, total: 150 });
      expect(node.cost).toBe(0.005);
      expect(node.completedAt).toBeGreaterThan(0);
    });
  });

  describe("markError", () => {
    test("transitions node to error with message", () => {
      const tracker = new DelegationTracker();
      const id = tracker.addNode("orch", null, "claude-opus-4-6");
      tracker.markRunning(id);
      tracker.markError(id, "session exploded");
      const node = tracker.getNode(id)!;
      expect(node.status).toBe("error");
      expect(node.error).toBe("session exploded");
      expect(node.completedAt).toBeGreaterThan(0);
    });
  });

  describe("getNode", () => {
    test("returns undefined for unknown ID", () => {
      const tracker = new DelegationTracker();
      expect(tracker.getNode("nope")).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/orchestrator/tracker.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement DelegationTracker core**

```typescript
// src/orchestrator/tracker.ts

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DelegationNode {
  id: string;
  sortieName: string;
  parentId: string | null;
  model: string;
  status: "pending" | "running" | "complete" | "error";
  tokens: { input: number; output: number; total: number };
  cost: number;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// DelegationTracker
// ---------------------------------------------------------------------------

export class DelegationTracker {
  private nodes = new Map<string, DelegationNode>();
  private nextId = 1;
  private listeners: Array<() => void> = [];

  addNode(sortieName: string, parentId: string | null, model: string): string {
    const id = `d-${String(this.nextId++).padStart(3, "0")}`;
    const node: DelegationNode = {
      id,
      sortieName,
      parentId,
      model,
      status: "pending",
      tokens: { input: 0, output: 0, total: 0 },
      cost: 0,
      startedAt: Date.now(),
      completedAt: null,
      error: null,
    };
    this.nodes.set(id, node);
    this.emit();
    return id;
  }

  markRunning(id: string): void {
    const node = this.require(id);
    node.status = "running";
    this.emit();
  }

  markComplete(
    id: string,
    tokens: { input: number; output: number; total: number },
    cost: number,
  ): void {
    const node = this.require(id);
    node.status = "complete";
    node.tokens = tokens;
    node.cost = cost;
    node.completedAt = Date.now();
    this.emit();
  }

  markError(id: string, error: string): void {
    const node = this.require(id);
    node.status = "error";
    node.error = error;
    node.completedAt = Date.now();
    this.emit();
  }

  getNode(id: string): DelegationNode | undefined {
    const node = this.nodes.get(id);
    return node ? { ...node, tokens: { ...node.tokens } } : undefined;
  }

  getChildren(id: string): DelegationNode[] {
    const children: DelegationNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.parentId === id) {
        children.push({ ...node, tokens: { ...node.tokens } });
      }
    }
    return children;
  }

  getRoots(): DelegationNode[] {
    const roots: DelegationNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.parentId === null) {
        roots.push({ ...node, tokens: { ...node.tokens } });
      }
    }
    return roots;
  }

  getAggregatedCost(id: string): number {
    const node = this.nodes.get(id);
    if (!node) return 0;
    let total = node.cost;
    for (const child of this.nodes.values()) {
      if (child.parentId === id) {
        total += this.getAggregatedCost(child.id);
      }
    }
    return total;
  }

  getAggregatedTokens(id: string): number {
    const node = this.nodes.get(id);
    if (!node) return 0;
    let total = node.tokens.total;
    for (const child of this.nodes.values()) {
      if (child.parentId === id) {
        total += this.getAggregatedTokens(child.id);
      }
    }
    return total;
  }

  on(_event: "update", callback: () => void): void {
    this.listeners.push(callback);
  }

  off(_event: "update", callback: () => void): void {
    this.listeners = this.listeners.filter((l) => l !== callback);
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private require(id: string): DelegationNode {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`Unknown delegation node: "${id}"`);
    }
    return node;
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/orchestrator/tracker.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/tracker.ts src/orchestrator/tracker.test.ts
git commit -m "feat(orchestrator): add DelegationTracker core node management"
```

---

### Task 2: DelegationTracker — Tree Queries, Aggregation, and Events

**Files:**
- Modify: `src/orchestrator/tracker.test.ts`

- [ ] **Step 1: Write failing tests for tree queries and events**

Append to `src/orchestrator/tracker.test.ts`:

```typescript
  describe("getChildren", () => {
    test("returns direct children of a node", () => {
      const tracker = new DelegationTracker();
      const root = tracker.addNode("orch", null, "claude-opus-4-6");
      const child1 = tracker.addNode("lead-a", root, "claude-opus-4-6");
      const child2 = tracker.addNode("lead-b", root, "claude-opus-4-6");
      // grandchild should NOT appear
      tracker.addNode("worker", child1, "claude-sonnet-4-20250514");

      const children = tracker.getChildren(root);
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.sortieName).sort()).toEqual(["lead-a", "lead-b"]);
    });

    test("returns empty array for leaf node", () => {
      const tracker = new DelegationTracker();
      const id = tracker.addNode("worker", null, "claude-sonnet-4-20250514");
      expect(tracker.getChildren(id)).toEqual([]);
    });
  });

  describe("getRoots", () => {
    test("returns nodes with null parentId", () => {
      const tracker = new DelegationTracker();
      const root = tracker.addNode("orch", null, "claude-opus-4-6");
      tracker.addNode("lead", root, "claude-opus-4-6");
      const roots = tracker.getRoots();
      expect(roots).toHaveLength(1);
      expect(roots[0].id).toBe(root);
    });
  });

  describe("getAggregatedCost", () => {
    test("sums cost of node and all descendants", () => {
      const tracker = new DelegationTracker();
      const root = tracker.addNode("orch", null, "claude-opus-4-6");
      const lead = tracker.addNode("lead", root, "claude-opus-4-6");
      const worker = tracker.addNode("worker", lead, "claude-sonnet-4-20250514");

      tracker.markRunning(root);
      tracker.markRunning(lead);
      tracker.markRunning(worker);
      tracker.markComplete(root, { input: 100, output: 50, total: 150 }, 0.10);
      tracker.markComplete(lead, { input: 200, output: 100, total: 300 }, 0.20);
      tracker.markComplete(worker, { input: 50, output: 25, total: 75 }, 0.05);

      expect(tracker.getAggregatedCost(root)).toBeCloseTo(0.35);
      expect(tracker.getAggregatedCost(lead)).toBeCloseTo(0.25);
      expect(tracker.getAggregatedCost(worker)).toBeCloseTo(0.05);
    });

    test("returns 0 for unknown node", () => {
      const tracker = new DelegationTracker();
      expect(tracker.getAggregatedCost("nope")).toBe(0);
    });
  });

  describe("getAggregatedTokens", () => {
    test("sums tokens of node and all descendants", () => {
      const tracker = new DelegationTracker();
      const root = tracker.addNode("orch", null, "claude-opus-4-6");
      const child = tracker.addNode("lead", root, "claude-opus-4-6");

      tracker.markRunning(root);
      tracker.markRunning(child);
      tracker.markComplete(root, { input: 500, output: 200, total: 700 }, 0.1);
      tracker.markComplete(child, { input: 300, output: 100, total: 400 }, 0.05);

      expect(tracker.getAggregatedTokens(root)).toBe(1100);
    });
  });

  describe("event emission", () => {
    test("fires update on addNode", () => {
      const tracker = new DelegationTracker();
      let fired = 0;
      tracker.on("update", () => { fired++; });
      tracker.addNode("orch", null, "claude-opus-4-6");
      expect(fired).toBe(1);
    });

    test("fires update on markRunning", () => {
      const tracker = new DelegationTracker();
      const id = tracker.addNode("orch", null, "claude-opus-4-6");
      let fired = 0;
      tracker.on("update", () => { fired++; });
      tracker.markRunning(id);
      expect(fired).toBe(1);
    });

    test("fires update on markComplete", () => {
      const tracker = new DelegationTracker();
      const id = tracker.addNode("orch", null, "claude-opus-4-6");
      tracker.markRunning(id);
      let fired = 0;
      tracker.on("update", () => { fired++; });
      tracker.markComplete(id, { input: 10, output: 5, total: 15 }, 0.001);
      expect(fired).toBe(1);
    });

    test("fires update on markError", () => {
      const tracker = new DelegationTracker();
      const id = tracker.addNode("orch", null, "claude-opus-4-6");
      tracker.markRunning(id);
      let fired = 0;
      tracker.on("update", () => { fired++; });
      tracker.markError(id, "boom");
      expect(fired).toBe(1);
    });

    test("off removes listener", () => {
      const tracker = new DelegationTracker();
      let fired = 0;
      const cb = () => { fired++; };
      tracker.on("update", cb);
      tracker.off("update", cb);
      tracker.addNode("orch", null, "claude-opus-4-6");
      expect(fired).toBe(0);
    });
  });

  describe("snapshot isolation", () => {
    test("getNode returns a copy, not a reference", () => {
      const tracker = new DelegationTracker();
      const id = tracker.addNode("orch", null, "claude-opus-4-6");
      const snap = tracker.getNode(id)!;
      snap.status = "error";
      expect(tracker.getNode(id)!.status).toBe("pending");
    });
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test src/orchestrator/tracker.test.ts`
Expected: All pass (implementation was included in Task 1)

- [ ] **Step 3: Commit**

```bash
git add src/orchestrator/tracker.test.ts
git commit -m "test(orchestrator): add tracker tree query, aggregation, and event tests"
```

---

### Task 3: Tree Formatter — renderTree Pure Function

**Files:**
- Create: `src/orchestrator/renderer.ts`
- Create: `src/orchestrator/renderer.test.ts`

- [ ] **Step 1: Write failing tests for tree rendering**

```typescript
// src/orchestrator/renderer.test.ts
import { describe, test, expect } from "bun:test";
import { renderTree } from "./renderer.js";
import { DelegationTracker } from "./tracker.js";

describe("renderTree", () => {
  test("renders a single root node", () => {
    const tracker = new DelegationTracker();
    tracker.addNode("orchestrator", null, "claude-opus-4-6");

    const lines = renderTree(tracker);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("o");
    expect(lines[0]).toContain("orchestrator");
    expect(lines[0]).toContain("$0.000");
    expect(lines[0]).toContain("claude-opus-4-6");
  });

  test("renders running status indicator", () => {
    const tracker = new DelegationTracker();
    const id = tracker.addNode("orchestrator", null, "claude-opus-4-6");
    tracker.markRunning(id);

    const lines = renderTree(tracker);
    expect(lines[0]).toMatch(/\*/);
  });

  test("renders complete status indicator", () => {
    const tracker = new DelegationTracker();
    const id = tracker.addNode("orchestrator", null, "claude-opus-4-6");
    tracker.markRunning(id);
    tracker.markComplete(id, { input: 500, output: 200, total: 700 }, 0.05);

    const lines = renderTree(tracker);
    expect(lines[0]).toMatch(/\+/);
    expect(lines[0]).toContain("$0.050");
  });

  test("renders error status indicator", () => {
    const tracker = new DelegationTracker();
    const id = tracker.addNode("orchestrator", null, "claude-opus-4-6");
    tracker.markRunning(id);
    tracker.markError(id, "boom");

    const lines = renderTree(tracker);
    expect(lines[0]).toMatch(/x/);
  });

  test("renders parent-child tree with box-drawing chars", () => {
    const tracker = new DelegationTracker();
    const root = tracker.addNode("orchestrator", null, "claude-opus-4-6");
    tracker.addNode("planning-lead", root, "claude-opus-4-6");
    tracker.addNode("engineering-lead", root, "claude-opus-4-6");

    const lines = renderTree(tracker);
    expect(lines).toHaveLength(3);
    // First child gets ├─, last child gets └─
    expect(lines[1]).toContain("\u251C\u2500");
    expect(lines[1]).toContain("planning-lead");
    expect(lines[2]).toContain("\u2514\u2500");
    expect(lines[2]).toContain("engineering-lead");
  });

  test("renders three-level tree", () => {
    const tracker = new DelegationTracker();
    const root = tracker.addNode("orchestrator", null, "claude-opus-4-6");
    const lead = tracker.addNode("planning-lead", root, "claude-opus-4-6");
    tracker.addNode("product-manager", lead, "claude-sonnet-4-20250514");
    tracker.addNode("ux-researcher", lead, "claude-sonnet-4-20250514");

    const lines = renderTree(tracker);
    expect(lines).toHaveLength(4);
    // Grandchildren should be indented further
    expect(lines[2]).toContain("product-manager");
    expect(lines[3]).toContain("ux-researcher");
  });

  test("formats token count in K", () => {
    const tracker = new DelegationTracker();
    const id = tracker.addNode("orch", null, "claude-opus-4-6");
    tracker.markRunning(id);
    tracker.markComplete(id, { input: 800000, output: 200000, total: 1000000 }, 2.5);

    const lines = renderTree(tracker);
    expect(lines[0]).toContain("1000K");
  });

  test("returns empty array for empty tracker", () => {
    const tracker = new DelegationTracker();
    expect(renderTree(tracker)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/orchestrator/renderer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement renderTree**

```typescript
// src/orchestrator/renderer.ts
import type { DelegationTracker, DelegationNode } from "./tracker.js";

// ---------------------------------------------------------------------------
// Status indicators
// ---------------------------------------------------------------------------

const STATUS_CHAR: Record<DelegationNode["status"], string> = {
  pending: "o",
  running: "*",
  complete: "+",
  error: "x",
};

// ---------------------------------------------------------------------------
// renderTree
// ---------------------------------------------------------------------------

export interface RenderOptions {
  maxDepth?: number; // undefined = unlimited
}

export function renderTree(
  tracker: DelegationTracker,
  options: RenderOptions = {},
): string[] {
  const roots = tracker.getRoots();
  if (roots.length === 0) return [];

  const lines: string[] = [];
  for (const root of roots) {
    renderNode(tracker, root, "", true, 0, options.maxDepth, lines);
  }
  return lines;
}

function renderNode(
  tracker: DelegationTracker,
  node: DelegationNode,
  prefix: string,
  isLast: boolean,
  depth: number,
  maxDepth: number | undefined,
  lines: string[],
): void {
  const indicator = STATUS_CHAR[node.status];
  const cost = `$${node.cost.toFixed(3)}`;
  const tokenK = `${Math.round(node.tokens.total / 1000)}K`;
  const label = `${indicator} ${node.sortieName}  ${cost}  ${tokenK} ${node.model}`;

  if (depth === 0) {
    lines.push(label);
  } else {
    const branch = isLast ? "\u2514\u2500 " : "\u251C\u2500 ";
    lines.push(`${prefix}${branch}${label}`);
  }

  // If we've hit max depth, stop recursing
  if (maxDepth !== undefined && depth >= maxDepth) return;

  const children = tracker.getChildren(node.id);
  const childPrefix =
    depth === 0
      ? "   "
      : `${prefix}${isLast ? "   " : "\u2502  "}`;

  for (let i = 0; i < children.length; i++) {
    const isChildLast = i === children.length - 1;
    renderNode(tracker, children[i], childPrefix, isChildLast, depth + 1, maxDepth, lines);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/orchestrator/renderer.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/renderer.ts src/orchestrator/renderer.test.ts
git commit -m "feat(orchestrator): add renderTree pure formatter"
```

---

### Task 4: Tree Formatter — Depth Limiting

**Files:**
- Modify: `src/orchestrator/renderer.test.ts`

- [ ] **Step 1: Write failing tests for depth-limited rendering**

Append to `src/orchestrator/renderer.test.ts`:

```typescript
describe("renderTree with maxDepth", () => {
  test("maxDepth 0 shows only roots", () => {
    const tracker = new DelegationTracker();
    const root = tracker.addNode("orchestrator", null, "claude-opus-4-6");
    tracker.addNode("lead", root, "claude-opus-4-6");
    tracker.addNode("worker", root, "claude-sonnet-4-20250514");

    const lines = renderTree(tracker, { maxDepth: 0 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("orchestrator");
  });

  test("maxDepth 1 shows roots and direct children", () => {
    const tracker = new DelegationTracker();
    const root = tracker.addNode("orchestrator", null, "claude-opus-4-6");
    const lead = tracker.addNode("lead", root, "claude-opus-4-6");
    tracker.addNode("worker-a", lead, "claude-sonnet-4-20250514");
    tracker.addNode("worker-b", lead, "claude-sonnet-4-20250514");

    const lines = renderTree(tracker, { maxDepth: 1 });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("orchestrator");
    expect(lines[1]).toContain("lead");
  });

  test("unlimited depth shows all levels", () => {
    const tracker = new DelegationTracker();
    const root = tracker.addNode("orch", null, "claude-opus-4-6");
    const lead = tracker.addNode("lead", root, "claude-opus-4-6");
    tracker.addNode("worker", lead, "claude-sonnet-4-20250514");

    const lines = renderTree(tracker);
    expect(lines).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test src/orchestrator/renderer.test.ts`
Expected: All pass (depth limiting was included in Task 3 implementation)

- [ ] **Step 3: Commit**

```bash
git add src/orchestrator/renderer.test.ts
git commit -m "test(orchestrator): add depth-limited rendering tests"
```

---

### Task 5: Wire Tracker Into DelegateToolDeps and Delegate Tool

**Files:**
- Modify: `src/orchestrator/delegate-tool.ts`
- Modify: `src/orchestrator/delegate-tool.test.ts`

This task changes the `DelegateToolDeps` interface by adding `tracker` and `callerNodeId`, then updates the `execute()` function to call tracker methods at each lifecycle point.

- [ ] **Step 1: Write failing tests for tracker integration**

Add these tests to `src/orchestrator/delegate-tool.test.ts`. First, update the imports and `makeDeps` helper:

At the top of the file, add the import:
```typescript
import { DelegationTracker } from "./tracker.js";
```

Update `makeDeps` to include tracker and callerNodeId:
```typescript
function makeDeps(overrides: Partial<DelegateToolDeps> = {}): DelegateToolDeps {
  const mockSession = makeMockSession("mock response");
  const tracker = new DelegationTracker();
  const rootId = tracker.addNode("test-lead", null, "claude-opus-4-6");
  return {
    registry: buildRegistry(sortiesConfig, CWD),
    callerName: "test-lead",
    callerNodeId: rootId,
    cwd: CWD,
    tracker,
    createSession: mock(async () => ({
      session: mockSession as any,
      dispose: mockSession.dispose,
    })),
    sendProgress: mock((_msg: ProgressMessage) => {}),
    ...overrides,
  };
}
```

Then add new tests inside the `describe("createDelegateTool")` block:

```typescript
  test("calls tracker.addNode before session creation", async () => {
    const tracker = new DelegationTracker();
    const rootId = tracker.addNode("test-lead", null, "claude-opus-4-6");
    const sessionMock = makeMockSession("done");
    const deps = makeDeps({
      tracker,
      callerNodeId: rootId,
      createSession: mock(async () => ({
        session: sessionMock as any,
        dispose: sessionMock.dispose,
      })),
    });

    const tool = createDelegateTool(deps);
    await tool.execute("call-t1", { sortie: "test-worker", task: "go" }, undefined, undefined, {} as any);

    // The tracker should have 2 nodes: root + child
    const children = tracker.getChildren(rootId);
    expect(children).toHaveLength(1);
    expect(children[0].sortieName).toBe("test-worker");
    expect(children[0].parentId).toBe(rootId);
  });

  test("marks tracker node complete on success", async () => {
    const tracker = new DelegationTracker();
    const rootId = tracker.addNode("test-lead", null, "claude-opus-4-6");
    const sessionMock = makeMockSession("done");
    const deps = makeDeps({
      tracker,
      callerNodeId: rootId,
      createSession: mock(async () => ({
        session: sessionMock as any,
        dispose: sessionMock.dispose,
      })),
    });

    const tool = createDelegateTool(deps);
    await tool.execute("call-t2", { sortie: "test-worker", task: "go" }, undefined, undefined, {} as any);

    const children = tracker.getChildren(rootId);
    expect(children[0].status).toBe("complete");
    expect(children[0].tokens.total).toBe(150);
    expect(children[0].cost).toBe(0.001);
  });

  test("marks tracker node error on failure", async () => {
    const tracker = new DelegationTracker();
    const rootId = tracker.addNode("test-lead", null, "claude-opus-4-6");
    const sessionMock = makeMockSession("unused");
    sessionMock.prompt = mock(async () => { throw new Error("exploded"); });
    const deps = makeDeps({
      tracker,
      callerNodeId: rootId,
      createSession: mock(async () => ({
        session: sessionMock as any,
        dispose: sessionMock.dispose,
      })),
    });

    const tool = createDelegateTool(deps);
    await tool.execute("call-t3", { sortie: "test-worker", task: "fail" }, undefined, undefined, {} as any);

    const children = tracker.getChildren(rootId);
    expect(children[0].status).toBe("error");
    expect(children[0].error).toBe("exploded");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/orchestrator/delegate-tool.test.ts`
Expected: FAIL — `callerNodeId` and `tracker` not in `DelegateToolDeps`

- [ ] **Step 3: Update DelegateToolDeps interface and execute() in delegate-tool.ts**

In `src/orchestrator/delegate-tool.ts`, update the `DelegateToolDeps` interface:

```typescript
export interface DelegateToolDeps {
  registry: SortieRegistry;
  callerName: string;
  callerNodeId: string;
  cwd: string;
  tracker: DelegationTracker;
  createSession: (config: {
    model: string;
    systemPrompt: string;
    tools: string[];
    cwd: string;
    writeScope?: string;
  }) => Promise<{ session: AgentSession; dispose: () => void }>;
  sendProgress: SendFn;
}
```

Add the import at the top:
```typescript
import type { DelegationTracker } from "./tracker.js";
```

In the `execute()` function, add tracker calls at the three lifecycle points.

After the `canDelegate` check and before `emitProgress(deps.sendProgress, targetName, "starting...")`:
```typescript
      // Register node in tracker
      const nodeId = deps.tracker.addNode(
        targetName,
        deps.callerNodeId,
        entry.definition.model,
      );
      deps.tracker.markRunning(nodeId);
```

After `emitProgress(deps.sendProgress, targetName, \`complete (${wallTimeMs}ms)\`)`:
```typescript
        deps.tracker.markComplete(nodeId, {
          input: stats.tokens.input,
          output: stats.tokens.output,
          total: stats.tokens.total,
        }, stats.cost);
```

In the `catch` block, before the return:
```typescript
        deps.tracker.markError(nodeId, message);
```

The `nodeId` variable needs to be declared in the outer scope (before the try block) since the catch needs it. Move the tracker.addNode call before the try:

```typescript
      // Register node in tracker
      const nodeId = deps.tracker.addNode(
        targetName,
        deps.callerNodeId,
        entry.definition.model,
      );

      const startTime = Date.now();
      let dispose: (() => void) | undefined;

      try {
        // Mark running after successful creation
        deps.tracker.markRunning(nodeId);
        // ... rest of try block
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/orchestrator/delegate-tool.test.ts`
Expected: All pass

- [ ] **Step 5: Run full test suite to check for breakage**

Run: `bun test`
Expected: Some tests may fail in `bootstrap.test.ts` and `delegation-chain.test.ts` because `DelegateToolDeps` changed. Note the failures — Task 6 will fix them.

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/delegate-tool.ts src/orchestrator/delegate-tool.test.ts
git commit -m "feat(orchestrator): wire DelegationTracker into delegate tool"
```

---

### Task 6: Wire Tracker in Bootstrap and Fix Downstream Tests

**Files:**
- Modify: `src/orchestrator/bootstrap.ts`
- Modify: `src/orchestrator/bootstrap.test.ts`
- Modify: `src/orchestrator/delegation-chain.test.ts`

This task adds the tracker to `startOrchestrator`, `createSortieSession`, and `buildOrchestratorConfig`, and fixes all tests that broke from the `DelegateToolDeps` interface change.

- [ ] **Step 1: Update bootstrap.ts**

Add import at the top of `src/orchestrator/bootstrap.ts`:
```typescript
import { DelegationTracker } from "./tracker.js";
```

In `buildOrchestratorConfig`, update the placeholder delegate deps to include tracker and callerNodeId:
```typescript
    const placeholderDeps: DelegateToolDeps = {
      registry,
      callerName: orchestratorName,
      callerNodeId: "placeholder",
      cwd,
      tracker: new DelegationTracker(),
      createSession: async (_cfg) => {
        throw new Error(
          "createSession not wired — delegate tool requires session wiring at runtime",
        );
      },
      sendProgress: (_msg) => {},
    };
```

Update `createSortieSession` to accept and thread the tracker. Change the function signature:
```typescript
async function createSortieSession(
  config: {
    model: string;
    systemPrompt: string;
    tools: string[];
    cwd: string;
    writeScope?: string;
  },
  registry: SortieRegistry,
  parentCwd: string,
  tracker: DelegationTracker,
  callerNodeId: string,
): Promise<{ session: AgentSession; dispose: () => void }>
```

Inside `createSortieSession`, update the delegate deps wiring:
```typescript
    const delegateDeps: DelegateToolDeps = {
      registry,
      callerName: sortieName,
      callerNodeId,
      cwd: parentCwd,
      tracker,
      createSession: (childConfig) =>
        createSortieSession(childConfig, registry, parentCwd, tracker, callerNodeId),
      sendProgress: () => {},
    };
```

Note: the `callerNodeId` for child delegate tools is the same as the parent's node ID. The delegate tool itself will create a new node via `tracker.addNode()` when it executes, and that new node ID becomes the `callerNodeId` for any further nested delegations. But we don't have that node ID here at session creation time — the delegate tool creates it at execution time. So we pass the parent's `callerNodeId` here and the delegate tool uses `deps.callerNodeId` as the parent when calling `tracker.addNode()`.

Update `startOrchestrator` to create a real tracker and orchestrator root node:
```typescript
export async function startOrchestrator(
  configPath: string,
  cwd: string,
): Promise<{ session: AgentSession; tracker: DelegationTracker; dispose: () => void }> {
  const orchConfig = buildOrchestratorConfig(configPath, cwd);

  // Create tracker and root node
  const tracker = new DelegationTracker();
  const orchNodeId = tracker.addNode("orchestrator", null, orchConfig.model);
  tracker.markRunning(orchNodeId);

  // Rebuild custom tools with real delegate wiring
  const wiredTools: ToolDefinition[] = [];

  for (const tool of sortieCustomTools) {
    if (orchConfig.customTools.some((t) => t.name === tool.name)) {
      wiredTools.push(tool);
    }
  }

  const delegateDeps: DelegateToolDeps = {
    registry: orchConfig.registry,
    callerName: "orchestrator",
    callerNodeId: orchNodeId,
    cwd,
    tracker,
    createSession: (childConfig) =>
      createSortieSession(childConfig, orchConfig.registry, cwd, tracker, orchNodeId),
    sendProgress: () => {},
  };
  wiredTools.push(createDelegateTool(delegateDeps) as unknown as ToolDefinition);

  // ... rest of session creation unchanged ...
```

Update the return type to include tracker:
```typescript
  return {
    session,
    tracker,
    dispose: () => {
      try {
        session.dispose();
      } catch {}
    },
  };
```

- [ ] **Step 2: Update bootstrap.test.ts**

The test creates mock agent definitions with `model: claude-opus-4-6`. The `buildOrchestratorConfig` tests should still pass since they don't call `startOrchestrator`. No changes needed to `bootstrap.test.ts` unless the placeholder deps cause type errors — if so, add `callerNodeId: "placeholder"` and `tracker: new DelegationTracker()` to fix them.

- [ ] **Step 3: Update delegation-chain.test.ts**

Add tracker and callerNodeId to the `DelegateToolDeps` construction in the test:

```typescript
import { DelegationTracker } from "./tracker.js";
```

In the test, where `DelegateToolDeps` is constructed, add:
```typescript
    const tracker = new DelegationTracker();
    const orchNodeId = tracker.addNode("orchestrator", null, "claude-opus-4-6");
```

And update the deps object:
```typescript
    const orchDeps: DelegateToolDeps = {
      registry,
      callerName: "orchestrator",
      callerNodeId: orchNodeId,
      cwd: tmp,
      tracker,
      createSession: mock(async (config) => {
        // ... existing mock ...
      }),
      sendProgress: mock(() => {}),
    };
```

Do the same for any nested delegate tool deps in the test.

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/bootstrap.ts src/orchestrator/bootstrap.test.ts src/orchestrator/delegation-chain.test.ts
git commit -m "feat(orchestrator): wire tracker through bootstrap and fix downstream tests"
```

---

### Task 7: Wire sendCustomMessage Through Delegation Chain

**Files:**
- Modify: `src/orchestrator/bootstrap.ts`
- Modify: `src/orchestrator/progress.ts`

This task wires the `sendProgress` no-op to actually call `session.sendCustomMessage`, and adds the `sortie:message` custom message for conversation capture.

- [ ] **Step 1: Update progress.ts with a message type for conversation capture**

Add to `src/orchestrator/progress.ts`:

```typescript
export interface AgentMessagePayload {
  customType: "sortie:message";
  content: {
    nodeId: string;
    sortieName: string;
    text: string;
  };
  display: string;
}

export function buildAgentMessage(
  nodeId: string,
  sortieName: string,
  text: string,
): AgentMessagePayload {
  const displayName = sortieName
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return {
    customType: "sortie:message",
    content: { nodeId, sortieName, text },
    display: `[${displayName}] ${text.slice(0, 200)}`,
  };
}
```

- [ ] **Step 2: Add test for buildAgentMessage**

Add to `src/orchestrator/progress.test.ts`:

```typescript
import { buildAgentMessage } from "./progress.js";

describe("buildAgentMessage", () => {
  test("formats sortie name to title case in display", () => {
    const msg = buildAgentMessage("d-001", "planning-lead", "Hello, checking in.");
    expect(msg.customType).toBe("sortie:message");
    expect(msg.content.nodeId).toBe("d-001");
    expect(msg.content.sortieName).toBe("planning-lead");
    expect(msg.content.text).toBe("Hello, checking in.");
    expect(msg.display).toContain("[Planning Lead]");
  });

  test("truncates long text in display", () => {
    const longText = "a".repeat(300);
    const msg = buildAgentMessage("d-001", "worker", longText);
    expect(msg.display.length).toBeLessThan(250);
  });
});
```

- [ ] **Step 3: Run progress tests**

Run: `bun test src/orchestrator/progress.test.ts`
Expected: All pass

- [ ] **Step 4: Wire sendCustomMessage in bootstrap.ts**

In `startOrchestrator`, after the session is created, update the delegate deps to wire `sendProgress`:

Replace the `sendProgress: () => {}` in the `delegateDeps` object with:
```typescript
    sendProgress: (msg) => {
      session.sendCustomMessage(
        {
          customType: msg.customType,
          content: msg.display,
          display: true,
          details: msg.content,
        },
        { triggerTurn: false },
      ).catch(() => {});
    },
```

Similarly, in `createSortieSession`, when a delegate tool is wired for a child sortie that can delegate, wire sendProgress the same way. Since the child session is created inside `createSortieSession`, update the delegate deps there too. But the child session may not be available at the point where we construct the deps — the session is created later. To handle this, use a mutable reference:

```typescript
  let sessionRef: AgentSession | undefined;

  if (config.tools.includes("delegate")) {
    const delegateDeps: DelegateToolDeps = {
      registry,
      callerName: sortieName,
      callerNodeId,
      cwd: parentCwd,
      tracker,
      createSession: (childConfig) =>
        createSortieSession(childConfig, registry, parentCwd, tracker, callerNodeId),
      sendProgress: (msg) => {
        sessionRef?.sendCustomMessage(
          {
            customType: msg.customType,
            content: msg.display,
            display: true,
            details: msg.content,
          },
          { triggerTurn: false },
        ).catch(() => {});
      },
    };
    customTools.push(createDelegateTool(delegateDeps) as unknown as ToolDefinition);
  }

  // ... session creation ...
  const { session } = await createAgentSession({ ... });
  sessionRef = session;
```

- [ ] **Step 5: Run full test suite**

Run: `bun test`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/progress.ts src/orchestrator/progress.test.ts src/orchestrator/bootstrap.ts
git commit -m "feat(orchestrator): wire sendCustomMessage and add sortie:message type"
```

---

### Task 8: Conversation Message Capture in Delegate Tool

**Files:**
- Modify: `src/orchestrator/delegate-tool.ts`
- Modify: `src/orchestrator/delegate-tool.test.ts`

After a child session completes, emit a `sortie:message` with the child's response text.

- [ ] **Step 1: Add sendMessage to DelegateToolDeps**

In `src/orchestrator/delegate-tool.ts`, add to the import:
```typescript
import { emitProgress, buildAgentMessage, type SendFn } from "./progress.js";
```

Add a `sendMessage` function to `DelegateToolDeps`:
```typescript
export interface DelegateToolDeps {
  registry: SortieRegistry;
  callerName: string;
  callerNodeId: string;
  cwd: string;
  tracker: DelegationTracker;
  createSession: (config: {
    model: string;
    systemPrompt: string;
    tools: string[];
    cwd: string;
    writeScope?: string;
  }) => Promise<{ session: AgentSession; dispose: () => void }>;
  sendProgress: SendFn;
  sendMessage: (msg: { customType: string; content: unknown; display: string }) => void;
}
```

In `execute()`, after capturing `responseText` and before the return, emit the message:
```typescript
        // Emit agent message for conversation display
        if (responseText) {
          deps.sendMessage(buildAgentMessage(nodeId, targetName, responseText));
        }
```

- [ ] **Step 2: Write failing test for message emission**

Add to `src/orchestrator/delegate-tool.test.ts`:

```typescript
  test("emits sortie:message with child response text", async () => {
    const tracker = new DelegationTracker();
    const rootId = tracker.addNode("test-lead", null, "claude-opus-4-6");
    const sessionMock = makeMockSession("I found 3 issues in the code.");
    const messages: unknown[] = [];
    const deps = makeDeps({
      tracker,
      callerNodeId: rootId,
      createSession: mock(async () => ({
        session: sessionMock as any,
        dispose: sessionMock.dispose,
      })),
      sendMessage: (msg) => { messages.push(msg); },
    });

    const tool = createDelegateTool(deps);
    await tool.execute("call-m1", { sortie: "test-worker", task: "review code" }, undefined, undefined, {} as any);

    expect(messages).toHaveLength(1);
    const msg = messages[0] as any;
    expect(msg.customType).toBe("sortie:message");
    expect(msg.content.sortieName).toBe("test-worker");
    expect(msg.content.text).toBe("I found 3 issues in the code.");
  });
```

Update `makeDeps` to include `sendMessage`:
```typescript
    sendMessage: mock((_msg: any) => {}),
```

- [ ] **Step 3: Run tests**

Run: `bun test src/orchestrator/delegate-tool.test.ts`
Expected: All pass

- [ ] **Step 4: Update bootstrap.ts to wire sendMessage**

In `startOrchestrator`, add `sendMessage` to the delegate deps:
```typescript
    sendMessage: (msg) => {
      session.sendCustomMessage(
        {
          customType: msg.customType,
          content: msg.display,
          display: true,
          details: msg.content,
        },
        { triggerTurn: false },
      ).catch(() => {});
    },
```

Do the same in `createSortieSession` for child delegate deps (using the `sessionRef` pattern from Task 7).

- [ ] **Step 5: Update delegation-chain.test.ts to include sendMessage**

Add `sendMessage: mock(() => {})` to all `DelegateToolDeps` constructions in the test.

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/orchestrator/delegate-tool.ts src/orchestrator/delegate-tool.test.ts src/orchestrator/bootstrap.ts src/orchestrator/delegation-chain.test.ts
git commit -m "feat(orchestrator): emit sortie:message for conversation display"
```

---

### Task 9: Update CLI and Public API

**Files:**
- Modify: `src/cli/orchestrate.ts`
- Modify: `src/orchestrator/index.ts`

- [ ] **Step 1: Update orchestrate.ts to use tracker**

Update `src/cli/orchestrate.ts` to destructure the tracker from `startOrchestrator` and print the tree after each interaction:

```typescript
import { createInterface } from "node:readline";
import { startOrchestrator } from "../orchestrator/index.js";
import { renderTree } from "../orchestrator/renderer.js";
import type { WriterLike } from "./validate.js";

export interface OrchestrateCommandOptions {
  configPath: string;
  cwd?: string;
  stdout?: WriterLike;
  stderr?: WriterLike;
  displayDepth?: number;
}

function writeLine(writer: WriterLike, message: string): void {
  writer.write(`${message}\n`);
}

export async function runOrchestrateCommand(
  options: OrchestrateCommandOptions,
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    writeLine(stdout, "Starting orchestrator...");
    const { session, tracker, dispose } = await startOrchestrator(options.configPath, cwd);
    writeLine(stdout, "Orchestrator ready. Type your request (Ctrl+D to exit).\n");

    const renderOpts = options.displayDepth !== undefined
      ? { maxDepth: options.displayDepth }
      : {};

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "You: ",
    });

    rl.prompt();

    for await (const line of rl) {
      const input = line.trim();
      if (!input) {
        rl.prompt();
        continue;
      }

      try {
        await session.prompt(input);
        const response = session.getLastAssistantText();
        if (response) {
          writeLine(stdout, `\nOrchestrator: ${response}\n`);
        }

        // Print delegation tree
        const treeLines = renderTree(tracker, renderOpts);
        if (treeLines.length > 0) {
          writeLine(stdout, "");
          for (const treeLine of treeLines) {
            writeLine(stdout, treeLine);
          }
          writeLine(stdout, "");
        }
      } catch (err) {
        writeLine(
          stderr,
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      rl.prompt();
    }

    dispose();
    writeLine(stdout, "\nSession ended.");
    return 0;
  } catch (error) {
    writeLine(
      stderr,
      error instanceof Error ? error.message : String(error),
    );
    return 1;
  }
}
```

- [ ] **Step 2: Update CLI argv parsing for --depth flag**

In `src/cli/index.ts`, find the orchestrate command parsing and add `--depth` flag support. Add after the `--config` parsing:

```typescript
    const depthIdx = args.indexOf("--depth");
    const displayDepth = depthIdx !== -1 ? parseInt(args[depthIdx + 1], 10) : undefined;
```

Pass it through to `runOrchestrateCommand`:
```typescript
    return runOrchestrateCommand({
      configPath: configFile,
      cwd: process.cwd(),
      displayDepth,
    });
```

- [ ] **Step 3: Update public API exports in index.ts**

In `src/orchestrator/index.ts`, add:
```typescript
export { DelegationTracker, type DelegationNode } from "./tracker.js";
export { renderTree, type RenderOptions } from "./renderer.js";
```

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/cli/orchestrate.ts src/cli/index.ts src/orchestrator/index.ts
git commit -m "feat(cli): display delegation tree after each orchestrator interaction"
```

---

### Task 10: Agent Definitions — Planning Team

**Files:**
- Create: `.pi/agents/planning-lead.md`
- Create: `.pi/agents/product-manager.md`
- Create: `.pi/agents/ux-researcher.md`

- [ ] **Step 1: Create planning-lead.md**

```markdown
---
name: planning-lead
description: Lead planner who decomposes tasks into structured plans and delegates research.
model: claude-opus-4-6
tools:
  - delegate
  - read
  - grep
  - find
  - ls
---

You are the Planning Lead. You decompose complex tasks into structured plans.

Responsibilities:
- Receive high-level tasks from the orchestrator
- Break them into research and analysis subtasks
- Delegate research to Product Manager and UX Researcher
- Synthesize their findings into a coherent plan
- Return the plan with clear action items and priorities

Constraints:
- Do not write code or modify files directly
- Delegate research work to your team members
- Return structured plans, not implementation
```

- [ ] **Step 2: Create product-manager.md**

```markdown
---
name: product-manager
description: Product analyst who researches requirements, user needs, and competitive landscape.
model: claude-sonnet-4-20250514
tools:
  - read
  - grep
  - find
  - ls
---

You are the Product Manager. You research and analyze product requirements.

Responsibilities:
- Analyze codebases for existing patterns and conventions
- Research user requirements and constraints from docs and code
- Identify risks, dependencies, and trade-offs
- Return structured findings with recommendations

Constraints:
- Read-only access — do not modify files
- Return findings as structured analysis, not code
- Focus on what should be built and why, not how
```

- [ ] **Step 3: Create ux-researcher.md**

```markdown
---
name: ux-researcher
description: UX analyst who evaluates interfaces, developer experience, and usability patterns.
model: claude-sonnet-4-20250514
tools:
  - read
  - grep
  - find
  - ls
---

You are the UX Researcher. You evaluate developer and user experience.

Responsibilities:
- Review interfaces, APIs, and developer-facing surfaces
- Identify usability issues and inconsistencies
- Analyze error messages, documentation, and onboarding flows
- Return structured findings with improvement recommendations

Constraints:
- Read-only access — do not modify files
- Focus on experience quality, not implementation details
- Return findings as structured analysis
```

- [ ] **Step 4: Commit**

```bash
git add .pi/agents/planning-lead.md .pi/agents/product-manager.md .pi/agents/ux-researcher.md
git commit -m "feat(agents): add planning team definitions"
```

---

### Task 11: Agent Definitions — Engineering Team

**Files:**
- Create: `.pi/agents/engineering-lead.md`
- Create: `.pi/agents/frontend-dev.md`
- Create: `.pi/agents/backend-dev.md`

- [ ] **Step 1: Create engineering-lead.md**

```markdown
---
name: engineering-lead
description: Lead engineer who architects solutions and delegates implementation work.
model: claude-opus-4-6
tools:
  - delegate
  - read
  - grep
  - find
  - ls
---

You are the Engineering Lead. You architect solutions and coordinate implementation.

Responsibilities:
- Receive implementation tasks from the orchestrator
- Design technical approaches and file structure
- Delegate frontend and backend work to specialists
- Review and integrate results from your team
- Return implementation summaries with key decisions

Constraints:
- Do not write code directly — delegate to Frontend Dev and Backend Dev
- Focus on architecture, integration, and technical decisions
- Ensure consistency across frontend and backend work
```

- [ ] **Step 2: Create frontend-dev.md**

```markdown
---
name: frontend-dev
description: Frontend developer specializing in UI, components, and client-side code.
model: claude-sonnet-4-20250514
tools:
  - read
  - write
  - edit
  - grep
  - find
  - ls
---

You are the Frontend Developer. You implement UI and client-side code.

Responsibilities:
- Implement UI components, layouts, and styling
- Write client-side logic and state management
- Follow existing project patterns and conventions
- Write tests for frontend code

Constraints:
- Stay within the frontend scope of the assigned task
- Follow existing code style and patterns
- Write tests alongside implementation
```

- [ ] **Step 3: Create backend-dev.md**

```markdown
---
name: backend-dev
description: Backend developer specializing in APIs, data, and server-side logic.
model: claude-sonnet-4-20250514
tools:
  - read
  - write
  - edit
  - grep
  - find
  - ls
---

You are the Backend Developer. You implement APIs and server-side logic.

Responsibilities:
- Implement API endpoints, data processing, and business logic
- Write server-side code following existing patterns
- Handle data validation, error handling, and integration
- Write tests for backend code

Constraints:
- Stay within the backend scope of the assigned task
- Follow existing code style and patterns
- Write tests alongside implementation
```

- [ ] **Step 4: Commit**

```bash
git add .pi/agents/engineering-lead.md .pi/agents/frontend-dev.md .pi/agents/backend-dev.md
git commit -m "feat(agents): add engineering team definitions"
```

---

### Task 12: Agent Definitions — Validation Team Update

**Files:**
- Create: `.pi/agents/qa-engineer.md`
- Create: `.pi/agents/security-reviewer.md`
- Modify: `.pi/agents/validation-lead.md`

- [ ] **Step 1: Create qa-engineer.md**

```markdown
---
name: qa-engineer
description: QA engineer who reviews code for correctness, edge cases, and test coverage.
model: claude-sonnet-4-20250514
tools:
  - read
  - grep
  - find
  - ls
---

You are the QA Engineer. You review code for correctness and quality.

Responsibilities:
- Inspect code changes for logical errors and edge cases
- Check test coverage and identify untested paths
- Verify error handling and boundary conditions
- Flag inconsistencies between code and documentation
- Return findings as structured YAML with severity ratings

Output format — strict YAML only:
```yaml
findings:
  - file: path/to/file.ts
    line: 42
    severity: major|minor|critical|info
    category: correctness|coverage|edge-case
    description: What the issue is and why it matters
```

Constraints:
- Read-only access — no write, no edit, no bash
- Return strict YAML only — no conversational text
- Apply verdict rules: critical = must fix, major = should fix, minor = advisory
```

- [ ] **Step 2: Create security-reviewer.md**

```markdown
---
name: security-reviewer
description: Security reviewer who audits code for vulnerabilities and unsafe patterns.
model: claude-sonnet-4-20250514
tools:
  - read
  - grep
  - find
  - ls
---

You are the Security Reviewer. You audit code for security vulnerabilities.

Responsibilities:
- Inspect code for injection, XSS, SSRF, and other OWASP vulnerabilities
- Check for unsafe data handling, credential exposure, and access control gaps
- Review dependency usage for known vulnerability patterns
- Verify input validation at system boundaries
- Return findings as structured YAML with severity ratings

Output format — strict YAML only:
```yaml
findings:
  - file: path/to/file.ts
    line: 42
    severity: major|minor|critical|info
    category: injection|auth|crypto|exposure|validation
    description: What the vulnerability is and how it could be exploited
```

Constraints:
- Read-only access — no write, no edit, no bash
- Return strict YAML only — no conversational text
- Apply verdict rules: critical = exploitable, major = needs mitigation, minor = hardening
```

- [ ] **Step 3: Update validation-lead.md frontmatter**

The validation-lead's `can_delegate_to` is defined in `harness.yaml`, not in the agent definition itself. The system prompt body can reference the new team members. No frontmatter changes needed — the definition file already has the correct tools and write_scope.

Update the system prompt body to reference the new worker names. In `src/orchestrator/bootstrap.ts`, the system prompt is built from the agent body + registry summary, so the lead will see "qa-engineer" and "security-reviewer" in its available sorties automatically.

No changes to `validation-lead.md` needed — the harness.yaml (Task 13) will define the new delegation targets.

- [ ] **Step 4: Commit**

```bash
git add .pi/agents/qa-engineer.md .pi/agents/security-reviewer.md
git commit -m "feat(agents): add validation team worker definitions"
```

---

### Task 13: Multi-Team harness.yaml and Config Rename

**Files:**
- Rename: `harness.yaml` → `harness-validation.yaml`
- Create: `harness.yaml` (new multi-team config)

- [ ] **Step 1: Rename existing harness.yaml**

```bash
git mv harness.yaml harness-validation.yaml
```

- [ ] **Step 2: Create new multi-team harness.yaml**

```yaml
# harness.yaml — Multi-team orchestration config
project: sortie-pi

roster:
  - name: claude-sonnet
    provider: anthropic
    model: claude-sonnet-4-20250514
    timeout: 120000
  - name: gemini-pro
    provider: google
    model: gemini-2.5-pro
    timeout: 120000
  - name: gpt
    provider: openai
    model: gpt-4.1
    timeout: 120000

debrief:
  model: claude-sonnet-4-20250514
  provider: anthropic
  prompt_template: prompts/debrief.md

triage:
  block_on: ["critical", "major"]
  convergence_threshold: 2
  max_remediation_cycles: 2

modes:
  code:
    prompt_template: prompts/sortie-code.md
  tests:
    prompt_template: prompts/sortie-tests.md
    roster: ["claude-sonnet", "gemini-pro"]
  docs:
    prompt_template: prompts/sortie-docs.md
    triage:
      block_on: ["critical"]

deposition_dir: .sortie
ledger_path: .sortie/ledger.yaml

sorties:
  orchestrator:
    definition: .pi/agents/orchestrator.md
    tools: [delegate, sortie-triage, sortie-ledger, sortie-identity]
    can_delegate_to: [planning-lead, engineering-lead, validation-lead]

  # --- Planning team ---
  planning-lead:
    definition: .pi/agents/planning-lead.md
    role: lead
    tools: [delegate, read, grep, find, ls]
    can_delegate_to: [product-manager, ux-researcher]
  product-manager:
    definition: .pi/agents/product-manager.md
    role: worker
    tools: [read, grep, find, ls]
    can_delegate_to: []
  ux-researcher:
    definition: .pi/agents/ux-researcher.md
    role: worker
    tools: [read, grep, find, ls]
    can_delegate_to: []

  # --- Engineering team ---
  engineering-lead:
    definition: .pi/agents/engineering-lead.md
    role: lead
    tools: [delegate, read, grep, find, ls]
    can_delegate_to: [frontend-dev, backend-dev]
  frontend-dev:
    definition: .pi/agents/frontend-dev.md
    role: worker
    tools: [read, write, edit, grep, find, ls]
    can_delegate_to: []
  backend-dev:
    definition: .pi/agents/backend-dev.md
    role: worker
    tools: [read, write, edit, grep, find, ls]
    can_delegate_to: []

  # --- Validation team ---
  validation-lead:
    definition: .pi/agents/validation-lead.md
    role: lead
    tools: [delegate, sortie-triage, sortie-ledger, sortie-identity, read, grep, find, ls]
    can_delegate_to: [qa-engineer, security-reviewer]
    write_scope: ".sortie/**"
  qa-engineer:
    definition: .pi/agents/qa-engineer.md
    role: worker
    tools: [read, grep, find, ls]
    can_delegate_to: []
  security-reviewer:
    definition: .pi/agents/security-reviewer.md
    role: worker
    tools: [read, grep, find, ls]
    can_delegate_to: []
```

- [ ] **Step 3: Update orchestrator.md can_delegate_to reference**

The orchestrator agent definition doesn't list `can_delegate_to` in its frontmatter — that's in `harness.yaml`. No change needed to the agent file.

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: Some tests may fail if they reference the old `harness.yaml` with the old sortie names (reviewer-claude, etc.). Check `src/cli/smoke.test.ts` and any tests that load `harness.yaml` directly.

- [ ] **Step 5: Fix any broken tests**

If smoke tests reference `harness.yaml` and expect the old sorties, update them to either:
- Use `harness-validation.yaml` explicitly
- Or update expectations for the new config

- [ ] **Step 6: Commit**

```bash
git add harness.yaml harness-validation.yaml
git commit -m "feat(config): multi-team harness.yaml, rename old to harness-validation.yaml"
```

---

### Task 14: Update Structural Tests for New Agent Definitions

**Files:**
- Modify: `src/test-support/agent-definitions.test.ts`

- [ ] **Step 1: Update the AGENTS list and tests**

Replace the entire file content:

```typescript
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = join(import.meta.dir, "../..");

const AGENTS = [
  "orchestrator.md",
  "validation-lead.md",
  "planning-lead.md",
  "product-manager.md",
  "ux-researcher.md",
  "engineering-lead.md",
  "frontend-dev.md",
  "backend-dev.md",
  "qa-engineer.md",
  "security-reviewer.md",
];

function readAgent(name: string): string {
  return readFileSync(join(ROOT, ".pi/agents", name), "utf-8");
}

function parseFrontmatter(name: string): Record<string, unknown> {
  const content = readAgent(name);
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    throw new Error(`Missing frontmatter in ${name}`);
  }
  return parse(match[1]) as Record<string, unknown>;
}

describe("agent definitions", () => {
  test("all expected agent files exist", () => {
    for (const name of AGENTS) {
      expect(existsSync(join(ROOT, ".pi/agents", name))).toBe(true);
    }
  });

  test("all agent files include required frontmatter keys", () => {
    for (const name of AGENTS) {
      const frontmatter = parseFrontmatter(name);
      expect(typeof frontmatter.name).toBe("string");
      expect(typeof frontmatter.description).toBe("string");
      expect(typeof frontmatter.model).toBe("string");
      expect(Array.isArray(frontmatter.tools)).toBe(true);
      expect((frontmatter.tools as unknown[]).length).toBeGreaterThan(0);
    }
  });

  test("orchestrator delegates and does not write", () => {
    const content = readAgent("orchestrator.md");
    expect(content).toContain("Delegate-only");
    expect(content).toContain("Zero writes");
    expect(content).toContain("delegate tool");
  });

  test("validation lead references sortie tools and .sortie write scope", () => {
    const content = readAgent("validation-lead.md");
    const frontmatter = parseFrontmatter("validation-lead.md");
    expect(content).toContain("sortie custom tools");
    expect(content).toContain(".sortie/**");
    expect(content).toContain("strict Sortie YAML only");
    expect(frontmatter.write_scope).toBe(".sortie/**");
  });

  test("validation lead includes protocol steps and may decline tasks", () => {
    const content = readAgent("validation-lead.md");
    expect(content).toContain("sortie-triage");
    expect(content).toContain("sortie-identity");
    expect(content).toContain("decline");
    expect(content).toContain("fail-secure");
  });

  test("worker agents are read-only (no delegate tool)", () => {
    const workers = [
      "product-manager.md",
      "ux-researcher.md",
      "qa-engineer.md",
      "security-reviewer.md",
    ];
    for (const name of workers) {
      const frontmatter = parseFrontmatter(name);
      const tools = frontmatter.tools as string[];
      expect(tools).not.toContain("delegate");
      expect(tools).toContain("read");
    }
  });

  test("lead agents have delegate tool", () => {
    const leads = [
      "planning-lead.md",
      "engineering-lead.md",
      "validation-lead.md",
    ];
    for (const name of leads) {
      const frontmatter = parseFrontmatter(name);
      const tools = frontmatter.tools as string[];
      expect(tools).toContain("delegate");
    }
  });

  test("engineering workers have write access", () => {
    const devs = ["frontend-dev.md", "backend-dev.md"];
    for (const name of devs) {
      const frontmatter = parseFrontmatter(name);
      const tools = frontmatter.tools as string[];
      expect(tools).toContain("write");
      expect(tools).toContain("edit");
    }
  });

  test("validation workers output YAML only", () => {
    const reviewers = ["qa-engineer.md", "security-reviewer.md"];
    for (const name of reviewers) {
      const content = readAgent(name);
      expect(content).toContain("strict YAML only");
    }
  });

  test("harness.yaml sorties reference existing agent definitions", () => {
    const harnessContent = readFileSync(join(ROOT, "harness.yaml"), "utf-8");
    const harness = parse(harnessContent) as Record<string, unknown>;
    const sorties = harness.sorties as Record<string, { definition: string }>;
    for (const [name, config] of Object.entries(sorties)) {
      const defPath = join(ROOT, config.definition);
      expect(existsSync(defPath)).toBe(true);
    }
  });

  test("can_delegate_to targets exist in sorties map", () => {
    const harnessContent = readFileSync(join(ROOT, "harness.yaml"), "utf-8");
    const harness = parse(harnessContent) as Record<string, unknown>;
    const sorties = harness.sorties as Record<string, { can_delegate_to: string[] }>;
    const sortieNames = new Set(Object.keys(sorties));
    for (const [name, config] of Object.entries(sorties)) {
      for (const target of config.can_delegate_to) {
        expect(sortieNames.has(target)).toBe(true);
      }
    }
  });

  test("delegation graph has no cycles", () => {
    const harnessContent = readFileSync(join(ROOT, "harness.yaml"), "utf-8");
    const harness = parse(harnessContent) as Record<string, unknown>;
    const sorties = harness.sorties as Record<string, { can_delegate_to: string[] }>;

    function hasCycle(name: string, visited: Set<string>): boolean {
      if (visited.has(name)) return true;
      visited.add(name);
      const targets = sorties[name]?.can_delegate_to ?? [];
      for (const target of targets) {
        if (hasCycle(target, new Set(visited))) return true;
      }
      return false;
    }

    for (const name of Object.keys(sorties)) {
      expect(hasCycle(name, new Set())).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test src/test-support/agent-definitions.test.ts`
Expected: All pass

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/test-support/agent-definitions.test.ts
git commit -m "test: update structural tests for multi-team agent definitions"
```

---

### Task 15: Remove Old Reviewer Agent Definitions

**Files:**
- Remove: `.pi/agents/reviewer-claude.md`
- Remove: `.pi/agents/reviewer-gemini.md`
- Remove: `.pi/agents/reviewer-codex.md`

- [ ] **Step 1: Check for references to old reviewer files**

Search the codebase for references to the old reviewer file names. The `harness-validation.yaml` still references them — that's expected (it's the old config). Check that no source code imports or test files reference them outside of `harness-validation.yaml`.

Run: `grep -r "reviewer-claude\|reviewer-gemini\|reviewer-codex" src/ .pi/agents/ harness.yaml`
Expected: No matches (the new `harness.yaml` doesn't reference them)

- [ ] **Step 2: Remove old files**

```bash
git rm .pi/agents/reviewer-claude.md .pi/agents/reviewer-gemini.md .pi/agents/reviewer-codex.md
```

- [ ] **Step 3: Update harness-validation.yaml if needed**

The old `harness-validation.yaml` still references these files. Since it's preserved as a reference config, the reviewer files should stay available for it. Two options:
- Keep the reviewer files and don't remove them
- Update `harness-validation.yaml` to use the new agent names

Since we want a clean break: update `harness-validation.yaml` to reference the new validation team workers instead of the old reviewer files. Change the sorties section:

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
    can_delegate_to: [qa-engineer, security-reviewer]
    write_scope: ".sortie/**"
  qa-engineer:
    definition: .pi/agents/qa-engineer.md
    role: worker
    tools: [read, grep, find, ls]
    can_delegate_to: []
  security-reviewer:
    definition: .pi/agents/security-reviewer.md
    role: worker
    tools: [read, grep, find, ls]
    can_delegate_to: []
```

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(agents): remove old reviewer definitions, update harness-validation.yaml"
```

---

### Task 16: Final Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Type check**

Run: `bun tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: All pass

- [ ] **Step 3: Manual smoke test**

Run: `bun run src/cli/index.ts orchestrate --config harness.yaml`
Expected: "Starting orchestrator..." then "Orchestrator ready." prompt appears. Type "ping" — orchestrator should respond. The delegation tree should print after the response.

- [ ] **Step 4: Verify with validation-only config**

Run: `bun run src/cli/index.ts orchestrate --config harness-validation.yaml`
Expected: Same behavior but with the smaller validation-only team.

- [ ] **Step 5: Verify depth limiting**

Run: `bun run src/cli/index.ts orchestrate --config harness.yaml --depth 1`
Expected: Tree only shows orchestrator + direct lead children, no workers.

- [ ] **Step 6: Commit any remaining fixes**

If any issues were found during verification, fix and commit them.
