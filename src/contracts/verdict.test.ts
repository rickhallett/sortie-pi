import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadFixture } from "../test-support/load-fixture.js";
import {
  writeVerdict,
  readVerdict,
  updateFindingDisposition,
} from "./verdict.js";
import type { Verdict, Finding } from "./types.js";

function makeVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    verdict: "pass",
    convergence: "none",
    findings: [],
    tree_sha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    cycle: 1,
    run_id: "a1b2c3d4-1",
    branch: "feature/add-parser",
    mode: "code",
    error: null,
    ...overrides,
  };
}

describe("writeVerdict", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sortie-verdict-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates verdict.yaml at correct path", () => {
    const v = makeVerdict();
    writeVerdict(tmpDir, v);

    const filePath = join(tmpDir, "verdict.yaml");
    expect(existsSync(filePath)).toBe(true);
  });
});

describe("readVerdict", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sortie-verdict-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("roundtrips correctly (write then read, compare all fields)", () => {
    const findings: Finding[] = [
      {
        id: "CF001",
        severity: "critical",
        file: "src/auth/session.ts",
        line: 15,
        category: "security",
        summary: "Session token logged in plaintext",
        detail: "Session token exposed in console.log output.",
        convergence: "convergent",
        sources: ["claude-sonnet-4-20250514", "gemini-2.5-pro"],
        disposition: null,
      },
    ];

    const original = makeVerdict({
      verdict: "fail",
      convergence: "convergent",
      findings,
      tree_sha: "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0a1b2",
      cycle: 2,
      run_id: "c3d4e5f6-2",
      branch: "feature/add-auth",
      mode: "code",
      debrief_model: "claude-sonnet-4-20250514",
      roster: ["claude-sonnet-4-20250514", "gemini-2.5-pro"],
      wall_time_ms: 12345,
      error: null,
    });

    writeVerdict(tmpDir, original);
    const loaded = readVerdict(tmpDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.verdict).toBe(original.verdict);
    expect(loaded!.convergence).toBe(original.convergence);
    expect(loaded!.tree_sha).toBe(original.tree_sha);
    expect(loaded!.cycle).toBe(original.cycle);
    expect(loaded!.run_id).toBe(original.run_id);
    expect(loaded!.branch).toBe(original.branch);
    expect(loaded!.mode).toBe(original.mode);
    expect(loaded!.debrief_model).toBe(original.debrief_model);
    expect(loaded!.roster).toEqual(original.roster);
    expect(loaded!.wall_time_ms).toBe(original.wall_time_ms);
    expect(loaded!.error).toBe(original.error);
    expect(loaded!.findings).toEqual(original.findings);
  });

  test("returns null for missing verdict", () => {
    const result = readVerdict(tmpDir);
    expect(result).toBeNull();
  });

  test("returns null for non-existent directory", () => {
    const result = readVerdict(join(tmpDir, "does-not-exist"));
    expect(result).toBeNull();
  });
});

describe("readVerdict — corrupt data", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sortie-verdict-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("throws on non-YAML content", () => {
    writeFileSync(join(tmpDir, "verdict.yaml"), "{{{{garbage", "utf-8");
    expect(() => readVerdict(tmpDir)).toThrow();
  });

  test("throws on YAML without verdict field", () => {
    writeFileSync(join(tmpDir, "verdict.yaml"), "foo: bar\n", "utf-8");
    expect(() => readVerdict(tmpDir)).toThrow(/verdict/i);
  });
});

describe("fixture: pass.yaml", () => {
  const fixture = loadFixture<Verdict>("verdicts/pass.yaml");

  test("has verdict 'pass'", () => {
    expect(fixture.verdict).toBe("pass");
  });

  test("has convergence 'none'", () => {
    expect(fixture.convergence).toBe("none");
  });

  test("has empty findings", () => {
    expect(fixture.findings).toEqual([]);
  });

  test("has correct tree_sha", () => {
    expect(fixture.tree_sha).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
  });

  test("has cycle 1", () => {
    expect(fixture.cycle).toBe(1);
  });

  test("has correct run_id", () => {
    expect(fixture.run_id).toBe("a1b2c3d4-1");
  });

  test("has correct branch", () => {
    expect(fixture.branch).toBe("feature/add-parser");
  });

  test("has correct mode", () => {
    expect(fixture.mode).toBe("code");
  });

  test("has null error", () => {
    expect(fixture.error).toBeNull();
  });
});

describe("fixture: fail.yaml", () => {
  const fixture = loadFixture<Verdict>("verdicts/fail.yaml");

  test("has verdict 'fail'", () => {
    expect(fixture.verdict).toBe("fail");
  });

  test("has convergence 'convergent'", () => {
    expect(fixture.convergence).toBe("convergent");
  });

  test("has one finding", () => {
    expect(fixture.findings).toHaveLength(1);
  });

  test("finding has convergent convergence", () => {
    expect(fixture.findings[0].convergence).toBe("convergent");
  });

  test("finding has sources from multiple reviewers", () => {
    const sources = fixture.findings[0].sources;
    expect(sources).toBeDefined();
    expect(sources!.length).toBeGreaterThanOrEqual(2);
  });

  test("finding has correct severity", () => {
    expect(fixture.findings[0].severity).toBe("critical");
  });

  test("finding has correct id", () => {
    expect(fixture.findings[0].id).toBe("CF001");
  });
});

describe("updateFindingDisposition", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sortie-verdict-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("changes disposition for one finding", () => {
    const findings: Finding[] = [
      {
        id: "CF001",
        severity: "critical",
        file: "src/auth/session.ts",
        line: 15,
        category: "security",
        summary: "Session token logged",
        detail: "Token exposed.",
        convergence: "convergent",
        sources: ["claude-sonnet-4-20250514", "gemini-2.5-pro"],
        disposition: null,
      },
    ];

    const v = makeVerdict({ verdict: "fail", convergence: "convergent", findings });
    writeVerdict(tmpDir, v);

    updateFindingDisposition(tmpDir, "CF001", "fixed");

    const updated = readVerdict(tmpDir);
    expect(updated).not.toBeNull();
    expect(updated!.findings[0].disposition).toBe("fixed");
  });

  test("preserves other finding fields", () => {
    const findings: Finding[] = [
      {
        id: "CF001",
        severity: "critical",
        file: "src/auth/session.ts",
        line: 15,
        category: "security",
        summary: "Session token logged",
        detail: "Token exposed.",
        convergence: "convergent",
        sources: ["claude-sonnet-4-20250514", "gemini-2.5-pro"],
        disposition: null,
      },
      {
        id: "CF002",
        severity: "minor",
        file: "src/utils/parse.ts",
        line: 42,
        category: "style",
        summary: "Unused variable",
        detail: "Variable tempResult is assigned but never read.",
        convergence: "divergent",
        sources: ["gemini-2.5-pro"],
        disposition: null,
      },
    ];

    const v = makeVerdict({ verdict: "fail", convergence: "mixed", findings });
    writeVerdict(tmpDir, v);

    updateFindingDisposition(tmpDir, "CF001", "false-positive");

    const updated = readVerdict(tmpDir);
    expect(updated).not.toBeNull();

    // Updated finding has new disposition but other fields preserved
    const f1 = updated!.findings[0];
    expect(f1.disposition).toBe("false-positive");
    expect(f1.id).toBe("CF001");
    expect(f1.severity).toBe("critical");
    expect(f1.file).toBe("src/auth/session.ts");
    expect(f1.line).toBe(15);
    expect(f1.category).toBe("security");
    expect(f1.summary).toBe("Session token logged");
    expect(f1.detail).toBe("Token exposed.");
    expect(f1.convergence).toBe("convergent");
    expect(f1.sources).toEqual(["claude-sonnet-4-20250514", "gemini-2.5-pro"]);

    // Other finding is untouched
    const f2 = updated!.findings[1];
    expect(f2.disposition).toBeNull();
    expect(f2.id).toBe("CF002");
    expect(f2.severity).toBe("minor");
  });

  test("throws for non-existent finding ID", () => {
    const findings: Finding[] = [
      {
        id: "CF001",
        severity: "critical",
        file: "src/auth/session.ts",
        line: 15,
        category: "security",
        summary: "Session token logged",
        detail: "Token exposed.",
        disposition: null,
      },
    ];

    const v = makeVerdict({ verdict: "fail", findings });
    writeVerdict(tmpDir, v);

    expect(() => {
      updateFindingDisposition(tmpDir, "NONEXISTENT", "fixed");
    }).toThrow();
  });
});
