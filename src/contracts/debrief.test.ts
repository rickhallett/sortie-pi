import { describe, test, expect } from "bun:test";
import { loadFixture } from "../test-support/load-fixture.js";
import { aggregateFallback } from "./debrief.js";
import type { ReviewerOutput, Finding } from "./types.js";

interface DebriefFixture {
  description: string;
  reviewers: ReviewerOutput[];
  expected_verdict?: string;
  expected_convergence?: string;
  expected_convergent_count?: number;
  expected_divergent_count?: number;
  expected_findings_count?: number;
  expected_message?: string;
  expected_exit_code?: number;
  debrief_error?: string;
}

describe("aggregateFallback", () => {
  describe("all-error.yaml — all reviewers errored", () => {
    const fixture = loadFixture<DebriefFixture>("debrief-inputs/all-error.yaml");

    test("verdict is 'error'", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.verdict).toBe("error");
    });

    test("convergence is 'none'", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.convergence).toBe("none");
    });

    test("findings is empty", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.findings).toEqual([]);
    });

    test("error message matches fail-secure wording", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.error).toBe(
        "Pipeline failed: all reviewers errored -- blocking merge (fail-secure)",
      );
    });
  });

  describe("failure-scenarios/all-reviewers-error.yaml — 3 reviewers all errored", () => {
    const fixture = loadFixture<DebriefFixture>(
      "failure-scenarios/all-reviewers-error.yaml",
    );

    test("verdict is 'error'", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.verdict).toBe("error");
    });

    test("convergence is 'none'", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.convergence).toBe("none");
    });

    test("findings is empty", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.findings).toEqual([]);
    });

    test("error message matches fail-secure wording", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.error).toBe(
        "Pipeline failed: all reviewers errored -- blocking merge (fail-secure)",
      );
    });
  });

  describe("partial-error.yaml — one reviewer errors, one succeeds", () => {
    const fixture = loadFixture<DebriefFixture>(
      "debrief-inputs/partial-error.yaml",
    );

    test("verdict is 'pass_with_findings'", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.verdict).toBe("pass_with_findings");
    });

    test("convergence is 'divergent'", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.convergence).toBe("divergent");
    });

    test("aggregates findings from successful reviewer only", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.findings.length).toBe(1);
    });

    test("aggregated finding preserves file, line, category, detail from original", () => {
      const result = aggregateFallback(fixture.reviewers);
      const f = result.findings[0];
      // These come from the gemini reviewer in the fixture
      expect(f.file).toBe("src/api/handler.ts");
      expect(f.line).toBe(78);
      expect(f.category).toBe("correctness");
      expect(f.detail).toBe("Response body accessed without null guard.");
      expect(f.severity).toBe("major");
      expect(f.id).toBe("F001");
    });

    test("finding has convergence 'divergent'", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.findings[0].convergence).toBe("divergent");
    });

    test("finding has sources set to successful reviewer model", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.findings[0].sources).toEqual(["gemini-2.5-pro"]);
    });

    test("error is null", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.error).toBeNull();
    });
  });

  describe("two-agree.yaml — both reviewers flag same issue (fallback still divergent)", () => {
    const fixture = loadFixture<DebriefFixture>(
      "debrief-inputs/two-agree.yaml",
    );

    test("verdict is 'fail' (critical findings present)", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.verdict).toBe("fail");
    });

    test("convergence is 'divergent' (fallback cannot determine convergence)", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.convergence).toBe("divergent");
    });

    test("all findings marked divergent even though reviewers agree", () => {
      const result = aggregateFallback(fixture.reviewers);
      for (const finding of result.findings) {
        expect(finding.convergence).toBe("divergent");
      }
    });

    test("findings aggregated from both reviewers", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.findings.length).toBe(2);
    });

    test("aggregated findings preserve file, line, category, detail from originals", () => {
      const result = aggregateFallback(fixture.reviewers);
      for (const f of result.findings) {
        expect(f.file).toBe("src/auth/session.ts");
        expect(f.line).toBe(15);
        expect(f.category).toBe("security");
        expect(typeof f.detail).toBe("string");
        expect(f.detail.length).toBeGreaterThan(0);
      }
    });

    test("each finding has sources set to its reviewer model", () => {
      const result = aggregateFallback(fixture.reviewers);
      const sourceModels = result.findings.map((f) => f.sources);
      expect(sourceModels).toContainEqual(["claude-sonnet-4-20250514"]);
      expect(sourceModels).toContainEqual(["gemini-2.5-pro"]);
    });

    test("error is null", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.error).toBeNull();
    });
  });

  describe("two-disagree.yaml — reviewers flag different issues", () => {
    const fixture = loadFixture<DebriefFixture>(
      "debrief-inputs/two-disagree.yaml",
    );

    test("verdict is 'pass_with_findings' (no critical findings)", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.verdict).toBe("pass_with_findings");
    });

    test("convergence is 'divergent'", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.convergence).toBe("divergent");
    });

    test("all findings marked divergent", () => {
      const result = aggregateFallback(fixture.reviewers);
      for (const finding of result.findings) {
        expect(finding.convergence).toBe("divergent");
      }
    });

    test("findings aggregated from both reviewers", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.findings.length).toBe(2);
    });

    test("error is null", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.error).toBeNull();
    });
  });

  describe("mixed.yaml — convergent + divergent findings, has critical", () => {
    const fixture = loadFixture<DebriefFixture>("debrief-inputs/mixed.yaml");

    test("verdict is 'fail' (critical finding present)", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.verdict).toBe("fail");
    });

    test("convergence is 'divergent' (fallback always divergent)", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.convergence).toBe("divergent");
    });

    test("all findings marked divergent in fallback mode", () => {
      const result = aggregateFallback(fixture.reviewers);
      for (const finding of result.findings) {
        expect(finding.convergence).toBe("divergent");
      }
    });

    test("aggregates all findings from both reviewers", () => {
      const result = aggregateFallback(fixture.reviewers);
      // claude-sonnet has 2 findings, gemini has 1 = 3 total
      expect(result.findings.length).toBe(3);
    });

    test("aggregated findings preserve all original fields across reviewers", () => {
      const result = aggregateFallback(fixture.reviewers);
      // Every finding must have file, line, category, detail, severity, id
      for (const f of result.findings) {
        expect(typeof f.file).toBe("string");
        expect(typeof f.line).toBe("number");
        expect(typeof f.category).toBe("string");
        expect(typeof f.detail).toBe("string");
        expect(["critical", "major", "minor"]).toContain(f.severity);
        expect(typeof f.id).toBe("string");
      }
    });

    test("error is null", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.error).toBeNull();
    });
  });

  describe("failure-scenarios/debrief-fallback.yaml — debrief model fails", () => {
    const fixture = loadFixture<DebriefFixture>(
      "failure-scenarios/debrief-fallback.yaml",
    );

    test("verdict is 'pass_with_findings'", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.verdict).toBe("pass_with_findings");
    });

    test("convergence is 'divergent'", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.convergence).toBe("divergent");
    });

    test("findings count matches expected", () => {
      const result = aggregateFallback(fixture.reviewers);
      expect(result.findings.length).toBe(fixture.expected_findings_count!);
    });

    test("all findings marked divergent", () => {
      const result = aggregateFallback(fixture.reviewers);
      for (const finding of result.findings) {
        expect(finding.convergence).toBe("divergent");
      }
    });

    test("fallback findings preserve file, line, category from originals", () => {
      const result = aggregateFallback(fixture.reviewers);
      const files = result.findings.map(f => f.file);
      expect(files).toContain("src/utils/parse.ts");
      expect(files).toContain("src/api/handler.ts");
      for (const f of result.findings) {
        expect(typeof f.line).toBe("number");
        expect(typeof f.category).toBe("string");
      }
    });
  });

  describe("empty results array", () => {
    test("verdict is 'error'", () => {
      const result = aggregateFallback([]);
      expect(result.verdict).toBe("error");
    });

    test("convergence is 'none'", () => {
      const result = aggregateFallback([]);
      expect(result.convergence).toBe("none");
    });

    test("findings is empty", () => {
      const result = aggregateFallback([]);
      expect(result.findings).toEqual([]);
    });

    test("error message matches fail-secure wording", () => {
      const result = aggregateFallback([]);
      expect(result.error).toBe(
        "Pipeline failed: all reviewers errored -- blocking merge (fail-secure)",
      );
    });
  });

  describe("all pass with zero findings", () => {
    const reviewers: ReviewerOutput[] = [
      {
        model: "claude-sonnet-4-20250514",
        verdict: "pass",
        findings: [],
        error: null,
      },
      {
        model: "gemini-2.5-pro",
        verdict: "pass",
        findings: [],
        error: null,
      },
    ];

    test("verdict is 'pass'", () => {
      const result = aggregateFallback(reviewers);
      expect(result.verdict).toBe("pass");
    });

    test("convergence is 'none'", () => {
      const result = aggregateFallback(reviewers);
      expect(result.convergence).toBe("none");
    });

    test("findings is empty", () => {
      const result = aggregateFallback(reviewers);
      expect(result.findings).toEqual([]);
    });

    test("error is null", () => {
      const result = aggregateFallback(reviewers);
      expect(result.error).toBeNull();
    });
  });
});
