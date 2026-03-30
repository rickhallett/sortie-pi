import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadFixture } from "../test-support/load-fixture.js";
import { Ledger, computeSummary } from "./ledger.js";
import type { LedgerEntry, Disposition } from "./types.js";

describe("Ledger", () => {
  let tmpDir: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sortie-ledger-test-"));
    ledgerPath = join(tmpDir, "ledger.yaml");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("load()", () => {
    test("on missing file returns { runs: [] }", () => {
      const ledger = new Ledger(ledgerPath);
      const result = ledger.load();
      expect(result).toEqual({ runs: [] });
    });

    test("on single-run.yaml returns correct entry", () => {
      const fixture = loadFixture<{ runs: LedgerEntry[] }>(
        "ledger-entries/single-run.yaml",
      );
      const fixturePath = join(
        import.meta.dir,
        "../../fixtures/ledger-entries/single-run.yaml",
      );
      const ledger = new Ledger(fixturePath);
      const result = ledger.load();
      expect(result.runs).toHaveLength(1);
      expect(result.runs[0].run_id).toBe("a1b2c3d4-1");
      expect(result.runs[0].tree_sha).toBe(
        "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      );
      expect(result.runs[0].cycle).toBe(1);
      expect(result.runs[0].verdict).toBe("pass");
      expect(result.runs[0].findings).toEqual([]);
      expect(result.runs[0].findings_total).toBe(0);
      expect(result.runs[0].by_severity).toEqual({
        critical: 0,
        major: 0,
        minor: 0,
      });
      expect(result.runs[0].dispositions).toEqual({
        fixed: 0,
        "false-positive": 0,
        deferred: 0,
        disagree: 0,
      });
    });
  });

  describe("load() — corrupt data", () => {
    test("throws on non-YAML content", () => {
      writeFileSync(ledgerPath, "{{{{not yaml at all", "utf-8");
      const ledger = new Ledger(ledgerPath);
      expect(() => ledger.load()).toThrow();
    });

    test("throws on YAML without runs key", () => {
      writeFileSync(ledgerPath, "foo: bar\n", "utf-8");
      const ledger = new Ledger(ledgerPath);
      expect(() => ledger.load()).toThrow(/runs/i);
    });

    test("throws on YAML with runs as string", () => {
      writeFileSync(ledgerPath, "runs: not-an-array\n", "utf-8");
      const ledger = new Ledger(ledgerPath);
      expect(() => ledger.load()).toThrow(/runs/i);
    });
  });

  describe("append() + load() roundtrip", () => {
    test("appended entry persists and is loadable", () => {
      const ledger = new Ledger(ledgerPath);
      const fixture = loadFixture<{ runs: LedgerEntry[] }>(
        "ledger-entries/single-run.yaml",
      );
      const entry = fixture.runs[0];

      ledger.append(entry);

      // Re-instantiate to prove it was persisted to disk
      const ledger2 = new Ledger(ledgerPath);
      const result = ledger2.load();
      expect(result.runs).toHaveLength(1);
      expect(result.runs[0].run_id).toBe(entry.run_id);
      expect(result.runs[0].tree_sha).toBe(entry.tree_sha);
      expect(result.runs[0].cycle).toBe(entry.cycle);
      expect(result.runs[0].verdict).toBe(entry.verdict);
    });

    test("multiple appends accumulate", () => {
      const ledger = new Ledger(ledgerPath);
      const fixture = loadFixture<{ runs: LedgerEntry[] }>(
        "ledger-entries/multi-run.yaml",
      );

      ledger.append(fixture.runs[0]);
      ledger.append(fixture.runs[1]);

      const result = ledger.load();
      expect(result.runs).toHaveLength(2);
      expect(result.runs[0].run_id).toBe(fixture.runs[0].run_id);
      expect(result.runs[1].run_id).toBe(fixture.runs[1].run_id);
    });
  });

  describe("findRun()", () => {
    test("finds by tree_sha + cycle", () => {
      const ledger = new Ledger(ledgerPath);
      const fixture = loadFixture<{ runs: LedgerEntry[] }>(
        "ledger-entries/multi-run.yaml",
      );
      ledger.append(fixture.runs[0]);
      ledger.append(fixture.runs[1]);

      const found = ledger.findRun(
        "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
        1,
      );
      expect(found).toBeDefined();
      expect(found!.run_id).toBe("a1b2c3d4-1");
      expect(found!.tree_sha).toBe(
        "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      );
      expect(found!.cycle).toBe(1);
    });

    test("returns undefined for non-existent run", () => {
      const ledger = new Ledger(ledgerPath);
      const fixture = loadFixture<{ runs: LedgerEntry[] }>(
        "ledger-entries/single-run.yaml",
      );
      ledger.append(fixture.runs[0]);

      const found = ledger.findRun("nonexistent_sha_value_here_1234567890ab", 1);
      expect(found).toBeUndefined();
    });
  });

  describe("runsForBranch()", () => {
    test("returns matching runs from multi-run fixture", () => {
      const ledger = new Ledger(ledgerPath);
      const multiFixture = loadFixture<{ runs: LedgerEntry[] }>(
        "ledger-entries/multi-run.yaml",
      );
      const withDisp = loadFixture<{ runs: LedgerEntry[] }>(
        "ledger-entries/with-dispositions.yaml",
      );

      // Append all runs: multi-run has branch "feature/add-parser",
      // with-dispositions has branch "feature/add-auth"
      for (const run of multiFixture.runs) ledger.append(run);
      for (const run of withDisp.runs) ledger.append(run);

      const parserRuns = ledger.runsForBranch("feature/add-parser");
      expect(parserRuns).toHaveLength(2);
      expect(parserRuns.every((r) => r.branch === "feature/add-parser")).toBe(
        true,
      );

      const authRuns = ledger.runsForBranch("feature/add-auth");
      expect(authRuns).toHaveLength(1);
      expect(authRuns[0].branch).toBe("feature/add-auth");

      const noRuns = ledger.runsForBranch("feature/nonexistent");
      expect(noRuns).toHaveLength(0);
    });
  });

  describe("updateDisposition()", () => {
    test("changes one finding and recomputes summary", () => {
      const ledger = new Ledger(ledgerPath);
      const fixture = loadFixture<{ runs: LedgerEntry[] }>(
        "ledger-entries/multi-run.yaml",
      );
      // First run in multi-run has 1 finding (CF001, critical, convergent, disposition: null)
      ledger.append(fixture.runs[0]);

      const treeSha = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
      ledger.updateDisposition(treeSha, 1, "CF001", "fixed");

      const run = ledger.findRun(treeSha, 1);
      expect(run).toBeDefined();
      expect(run!.findings[0].disposition).toBe("fixed");
      expect(run!.dispositions.fixed).toBe(1);
      expect(run!.dispositions["false-positive"]).toBe(0);
      expect(run!.dispositions.deferred).toBe(0);
      expect(run!.dispositions.disagree).toBe(0);

      // Verify persisted to disk
      const ledger2 = new Ledger(ledgerPath);
      const reloaded = ledger2.findRun(treeSha, 1);
      expect(reloaded!.findings[0].disposition).toBe("fixed");
      expect(reloaded!.dispositions.fixed).toBe(1);
    });
  });

  describe("bulkDispose()", () => {
    test("changes all findings in a run", () => {
      const ledger = new Ledger(ledgerPath);
      const fixture = loadFixture<{ runs: LedgerEntry[] }>(
        "ledger-entries/with-dispositions.yaml",
      );
      // with-dispositions has 2 findings: CF001 (fixed), CF002 (false-positive)
      ledger.append(fixture.runs[0]);

      const treeSha = "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0a1b2";
      ledger.bulkDispose(treeSha, 1, "deferred");

      const run = ledger.findRun(treeSha, 1);
      expect(run).toBeDefined();
      expect(run!.findings).toHaveLength(2);
      expect(run!.findings[0].disposition).toBe("deferred");
      expect(run!.findings[1].disposition).toBe("deferred");
      expect(run!.dispositions).toEqual({
        fixed: 0,
        "false-positive": 0,
        deferred: 2,
        disagree: 0,
      });

      // Verify persisted to disk
      const ledger2 = new Ledger(ledgerPath);
      const reloaded = ledger2.findRun(treeSha, 1);
      expect(reloaded!.findings[0].disposition).toBe("deferred");
      expect(reloaded!.findings[1].disposition).toBe("deferred");
      expect(reloaded!.dispositions.deferred).toBe(2);
    });
  });
});

describe("computeSummary()", () => {
  test("produces correct counts from fixture data with no findings", () => {
    const fixture = loadFixture<{ runs: LedgerEntry[] }>(
      "ledger-entries/single-run.yaml",
    );
    const entry = fixture.runs[0];
    const summary = computeSummary(entry);

    expect(summary.findings_total).toBe(0);
    expect(summary.findings_convergent).toBe(0);
    expect(summary.findings_divergent).toBe(0);
    expect(summary.by_severity).toEqual({ critical: 0, major: 0, minor: 0 });
    expect(summary.dispositions).toEqual({
      fixed: 0,
      "false-positive": 0,
      deferred: 0,
      disagree: 0,
    });
  });

  test("produces correct counts from fixture data with findings", () => {
    const fixture = loadFixture<{ runs: LedgerEntry[] }>(
      "ledger-entries/multi-run.yaml",
    );
    // First run: 1 critical convergent finding, no dispositions
    const entry = fixture.runs[0];
    const summary = computeSummary(entry);

    expect(summary.findings_total).toBe(1);
    expect(summary.findings_convergent).toBe(1);
    expect(summary.findings_divergent).toBe(0);
    expect(summary.by_severity).toEqual({ critical: 1, major: 0, minor: 0 });
    expect(summary.dispositions).toEqual({
      fixed: 0,
      "false-positive": 0,
      deferred: 0,
      disagree: 0,
    });
  });

  test("produces correct counts from fixture data with dispositions", () => {
    const fixture = loadFixture<{ runs: LedgerEntry[] }>(
      "ledger-entries/with-dispositions.yaml",
    );
    // 2 findings: CF001 major convergent (fixed), CF002 minor divergent (false-positive)
    const entry = fixture.runs[0];
    const summary = computeSummary(entry);

    expect(summary.findings_total).toBe(2);
    expect(summary.findings_convergent).toBe(1);
    expect(summary.findings_divergent).toBe(1);
    expect(summary.by_severity).toEqual({ critical: 0, major: 1, minor: 1 });
    expect(summary.dispositions).toEqual({
      fixed: 1,
      "false-positive": 1,
      deferred: 0,
      disagree: 0,
    });
  });
});
