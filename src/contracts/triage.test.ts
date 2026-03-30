import { describe, test, expect } from "bun:test";
import { loadFixture } from "../test-support/load-fixture.js";
import { triageVerdict } from "./triage.js";
import type { Finding, TriageConfig, TriageResult } from "./types.js";

interface TriageFixture {
  description: string;
  input_verdict: {
    verdict: string;
    convergence: string;
    findings: Finding[];
  };
  config: TriageConfig;
  expected: {
    action: string;
    exit_code: number;
    blocking_findings?: Finding[];
    blocking_findings_count?: number;
    advisory_findings?: Finding[];
    advisory_findings_count?: number;
    all_clear_warning?: string | null;
  };
}

describe("triageVerdict", () => {
  describe("merge.yaml — no findings, clean merge", () => {
    const fixture = loadFixture<TriageFixture>("triage-outcomes/merge.yaml");

    test("action is 'merge'", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.action).toBe("merge");
    });

    test("exit_code is 0", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.exit_code).toBe(0);
    });

    test("blocking_findings is empty", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.blocking_findings).toEqual([]);
    });

    test("advisory_findings is empty", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.advisory_findings).toEqual([]);
    });

    test("all_clear_warning is present", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.all_clear_warning).toBe(
        "Zero findings across all reviewers — verify review depth",
      );
    });
  });

  describe("merge-with-findings.yaml — divergent findings only", () => {
    const fixture = loadFixture<TriageFixture>(
      "triage-outcomes/merge-with-findings.yaml",
    );

    test("action is 'merge_with_findings'", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.action).toBe("merge_with_findings");
    });

    test("exit_code is 2", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.exit_code).toBe(2);
    });

    test("blocking_findings is empty", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.blocking_findings).toEqual([]);
    });

    test("advisory_findings count matches expected", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.advisory_findings.length).toBe(
        fixture.expected.advisory_findings_count!,
      );
    });
  });

  describe("block-convergent-critical.yaml — convergent critical blocks", () => {
    const fixture = loadFixture<TriageFixture>(
      "triage-outcomes/block-convergent-critical.yaml",
    );

    test("action is 'block'", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.action).toBe("block");
    });

    test("exit_code is 1", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.exit_code).toBe(1);
    });

    test("blocking_findings count matches expected", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.blocking_findings.length).toBe(
        fixture.expected.blocking_findings_count!,
      );
    });

    test("advisory_findings is empty", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.advisory_findings).toEqual([]);
    });
  });

  describe("no-block-divergent-critical.yaml — divergent critical does NOT block", () => {
    const fixture = loadFixture<TriageFixture>(
      "triage-outcomes/no-block-divergent-critical.yaml",
    );

    test("action is 'merge_with_findings' (NOT block)", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.action).toBe("merge_with_findings");
    });

    test("exit_code is 2 (NOT 1)", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.exit_code).toBe(2);
    });

    test("blocking_findings is empty", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.blocking_findings).toEqual([]);
    });

    test("advisory_findings count matches expected", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.advisory_findings.length).toBe(
        fixture.expected.advisory_findings_count!,
      );
    });
  });

  describe("block-convergent-major.yaml — convergent major blocks when in block_on", () => {
    const fixture = loadFixture<TriageFixture>(
      "triage-outcomes/block-convergent-major.yaml",
    );

    test("action is 'block'", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.action).toBe("block");
    });

    test("exit_code is 1", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.exit_code).toBe(1);
    });

    test("blocking_findings count matches expected", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.blocking_findings.length).toBe(
        fixture.expected.blocking_findings_count!,
      );
    });

    test("advisory_findings is empty", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.advisory_findings).toEqual([]);
    });
  });
});
