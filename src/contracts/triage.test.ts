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

    test("advisory findings preserve original finding payloads", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      for (const advisory of result.advisory_findings) {
        const original = fixture.input_verdict.findings.find(f => f.id === advisory.id);
        expect(original).toBeDefined();
        expect(advisory.severity).toBe(original!.severity);
        expect(advisory.file).toBe(original!.file);
        expect(advisory.convergence).toBe(original!.convergence);
        expect(advisory.category).toBe(original!.category);
        expect(advisory.summary).toBe(original!.summary);
      }
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

    test("blocking finding preserves original payload", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      const blocking = result.blocking_findings[0];
      const original = fixture.input_verdict.findings[0];
      expect(blocking.id).toBe(original.id);
      expect(blocking.severity).toBe(original.severity);
      expect(blocking.file).toBe(original.file);
      expect(blocking.convergence).toBe(original.convergence);
      expect(blocking.sources).toEqual(original.sources);
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

    test("divergent critical finding appears in advisory with full payload", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.advisory_findings[0].id).toBe(fixture.input_verdict.findings[0].id);
      expect(result.advisory_findings[0].severity).toBe("critical");
      expect(result.advisory_findings[0].convergence).toBe("divergent");
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

    test("blocking finding preserves original payload", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      const blocking = result.blocking_findings[0];
      const original = fixture.input_verdict.findings[0];
      expect(blocking.id).toBe(original.id);
      expect(blocking.severity).toBe(original.severity);
      expect(blocking.file).toBe(original.file);
      expect(blocking.convergence).toBe(original.convergence);
      expect(blocking.sources).toEqual(original.sources);
      expect(blocking.category).toBe(original.category);
      expect(blocking.summary).toBe(original.summary);
    });

    test("advisory_findings is empty", () => {
      const result = triageVerdict(fixture.input_verdict.findings, fixture.config);
      expect(result.advisory_findings).toEqual([]);
    });
  });
});
