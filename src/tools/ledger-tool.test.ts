import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse, stringify } from "yaml";
import { ledgerTool } from "./ledger-tool.js";
import type { LedgerEntry } from "../contracts/types.js";

/** Extract text from the first content block of a tool result. */
function textOf(result: { content: { type: string; text?: string }[] }): string {
  const block = result.content[0];
  if (block.type !== "text" || typeof block.text !== "string") {
    throw new Error("Expected text content block");
  }
  return block.text;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = {} as any;

function makeLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    run_id: "a1b2c3d4-1",
    tree_sha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    cycle: 1,
    timestamp: "2025-01-01T00:00:00Z",
    project: "test-project",
    branch: "feature/test",
    worker_branch: "sortie/feature/test",
    mode: "standard",
    verdict: "pass_with_findings",
    convergence: "convergent",
    debrief_model: "claude-3-opus",
    roster_used: ["model-a", "model-b"],
    model_status: {
      "model-a": { verdict: "pass", findings_count: 0, wall_time_ms: 1000, tokens: { input: 100, output: 50 } },
      "model-b": { verdict: "pass_with_findings", findings_count: 1, wall_time_ms: 2000, tokens: { input: 200, output: 100 } },
    },
    findings: [
      {
        id: "CF001",
        severity: "major",
        file: "main.ts",
        line: 42,
        category: "security",
        summary: "Unvalidated input",
        detail: "User input not checked",
        convergence: "convergent",
        disposition: null,
      },
    ],
    diff_stats: { files: 3, insertions: 50, deletions: 10 },
    wall_time_ms: 3000,
    tokens: { by_model: { "model-a": { input: 100, output: 50 }, "model-b": { input: 200, output: 100 } }, total: 450 },
    findings_total: 1,
    findings_convergent: 1,
    findings_divergent: 0,
    by_severity: { critical: 0, major: 1, minor: 0 },
    dispositions: { fixed: 0, "false-positive": 0, deferred: 0, disagree: 0 },
    ...overrides,
  };
}

describe("sortie-ledger tool", () => {
  let tmpDir: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sortie-ledger-tool-test-"));
    ledgerPath = join(tmpDir, "ledger.yaml");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("has correct name, label, and description", () => {
    expect(ledgerTool.name).toBe("sortie-ledger");
    expect(ledgerTool.label).toBe("Sortie Ledger");
    expect(typeof ledgerTool.description).toBe("string");
    expect(ledgerTool.description.length).toBeGreaterThan(0);
  });

  describe("action: find", () => {
    test("finds an existing run by tree_sha and cycle", async () => {
      const entry = makeLedgerEntry();
      writeFileSync(ledgerPath, stringify({ runs: [entry] }));

      const result = await ledgerTool.execute(
        "call-1",
        {
          action: "find",
          ledger_path: ledgerPath,
          tree_sha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
          cycle: 1,
        },
        undefined,
        undefined,
        ctx,
      );

      const parsed = parse(textOf(result));
      expect(parsed.run_id).toBe("a1b2c3d4-1");
      expect(parsed.tree_sha).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
      expect(parsed.cycle).toBe(1);
    });

    test("returns not-found message for nonexistent run", async () => {
      const entry = makeLedgerEntry();
      writeFileSync(ledgerPath, stringify({ runs: [entry] }));

      const result = await ledgerTool.execute(
        "call-2",
        {
          action: "find",
          ledger_path: ledgerPath,
          tree_sha: "0000000000000000000000000000000000000000",
          cycle: 99,
        },
        undefined,
        undefined,
        ctx,
      );

      const text = textOf(result);
      expect(text.toLowerCase()).toContain("not found");
    });
  });

  describe("action: branch", () => {
    test("returns runs for a given branch", async () => {
      const entry1 = makeLedgerEntry({ run_id: "a1b2c3d4-1", branch: "feature/test" });
      const entry2 = makeLedgerEntry({
        run_id: "b2c3d4e5-1",
        tree_sha: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0a1",
        branch: "feature/other",
      });
      const entry3 = makeLedgerEntry({
        run_id: "a1b2c3d4-2",
        cycle: 2,
        branch: "feature/test",
      });
      writeFileSync(ledgerPath, stringify({ runs: [entry1, entry2, entry3] }));

      const result = await ledgerTool.execute(
        "call-3",
        {
          action: "branch",
          ledger_path: ledgerPath,
          branch: "feature/test",
        },
        undefined,
        undefined,
        ctx,
      );

      const parsed = parse(textOf(result));
      expect(parsed).toHaveLength(2);
      expect(parsed[0].run_id).toBe("a1b2c3d4-1");
      expect(parsed[1].run_id).toBe("a1b2c3d4-2");
    });

    test("returns empty array for branch with no runs", async () => {
      const entry = makeLedgerEntry();
      writeFileSync(ledgerPath, stringify({ runs: [entry] }));

      const result = await ledgerTool.execute(
        "call-4",
        {
          action: "branch",
          ledger_path: ledgerPath,
          branch: "nonexistent-branch",
        },
        undefined,
        undefined,
        ctx,
      );

      const parsed = parse(textOf(result));
      expect(parsed).toHaveLength(0);
    });
  });

  describe("action: dispose", () => {
    test("updates a single finding disposition", async () => {
      const entry = makeLedgerEntry();
      writeFileSync(ledgerPath, stringify({ runs: [entry] }));

      const result = await ledgerTool.execute(
        "call-5",
        {
          action: "dispose",
          ledger_path: ledgerPath,
          tree_sha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
          cycle: 1,
          finding_id: "CF001",
          disposition: "fixed",
        },
        undefined,
        undefined,
        ctx,
      );

      const text = textOf(result).toLowerCase();
      expect(text).toContain("updated");

      // Verify the file was actually written
      const { Ledger } = await import("../contracts/ledger.js");
      const ledger = new Ledger(ledgerPath);
      const run = ledger.findRun("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0", 1);
      expect(run!.findings[0].disposition).toBe("fixed");
      expect(run!.dispositions.fixed).toBe(1);
    });
  });

  describe("action: bulk-dispose", () => {
    test("updates all findings in a run", async () => {
      const entry = makeLedgerEntry({
        findings: [
          {
            id: "CF001",
            severity: "major",
            file: "main.ts",
            line: 42,
            category: "security",
            summary: "Issue 1",
            detail: "Detail 1",
            convergence: "convergent",
            disposition: null,
          },
          {
            id: "CF002",
            severity: "minor",
            file: "utils.ts",
            line: 10,
            category: "style",
            summary: "Issue 2",
            detail: "Detail 2",
            convergence: "divergent",
            disposition: null,
          },
        ],
        findings_total: 2,
        findings_convergent: 1,
        findings_divergent: 1,
        by_severity: { critical: 0, major: 1, minor: 1 },
      });
      writeFileSync(ledgerPath, stringify({ runs: [entry] }));

      const result = await ledgerTool.execute(
        "call-6",
        {
          action: "bulk-dispose",
          ledger_path: ledgerPath,
          tree_sha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
          cycle: 1,
          disposition: "deferred",
        },
        undefined,
        undefined,
        ctx,
      );

      const text = textOf(result).toLowerCase();
      expect(text).toContain("updated");

      // Verify
      const { Ledger } = await import("../contracts/ledger.js");
      const ledger = new Ledger(ledgerPath);
      const run = ledger.findRun("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0", 1);
      expect(run!.findings[0].disposition).toBe("deferred");
      expect(run!.findings[1].disposition).toBe("deferred");
      expect(run!.dispositions.deferred).toBe(2);
    });
  });

  describe("malformed input handling", () => {
    test("returns error message for unknown action", async () => {
      writeFileSync(ledgerPath, stringify({ runs: [] }));

      const result = await ledgerTool.execute(
        "call-err-1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { action: "explode" as any, ledger_path: ledgerPath },
        undefined,
        undefined,
        ctx,
      );

      const text = textOf(result);
      expect(text.toLowerCase()).toContain("unknown action");
    });

    test("returns error message when tree_sha is missing for find action", async () => {
      writeFileSync(ledgerPath, stringify({ runs: [] }));

      const result = await ledgerTool.execute(
        "call-err-2",
        { action: "find", ledger_path: ledgerPath, cycle: 1 },
        undefined,
        undefined,
        ctx,
      );

      const text = textOf(result);
      expect(text).toMatch(/^Error: /);
    });

    test("returns run-not-found for nonexistent ledger file (treated as empty)", async () => {
      const result = await ledgerTool.execute(
        "call-err-3",
        {
          action: "find",
          ledger_path: "/tmp/nonexistent-ledger-file-abc123.yaml",
          tree_sha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
          cycle: 1,
        },
        undefined,
        undefined,
        ctx,
      );

      const text = textOf(result);
      expect(text.toLowerCase()).toContain("not found");
    });

    test("returns error message when cycle is missing for find action", async () => {
      writeFileSync(ledgerPath, stringify({ runs: [] }));

      const result = await ledgerTool.execute(
        "call-err-4",
        { action: "find", ledger_path: ledgerPath, tree_sha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0" },
        undefined,
        undefined,
        ctx,
      );

      const text = textOf(result);
      expect(text).toMatch(/^Error: /);
    });
  });
});
