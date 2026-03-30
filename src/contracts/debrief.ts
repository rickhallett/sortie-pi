import type {
  Finding,
  ReviewerOutput,
  VerdictConvergence,
  VerdictValue,
} from "./types.js";

const FAIL_SECURE_ERROR =
  "Pipeline failed: all reviewers errored -- blocking merge (fail-secure)";

export interface FallbackResult {
  verdict: VerdictValue;
  convergence: VerdictConvergence;
  findings: Finding[];
  error: string | null;
}

/**
 * Deterministic fallback aggregation when the debrief model fails.
 *
 * Since fallback mode has no model-based convergence analysis, all
 * findings are marked as divergent (Section 8.6, 11.1-11.4).
 *
 * Decision logic:
 * 1. All error / empty results -> error + fail-secure
 * 2. Partial error -> filter to successful, aggregate, convergence = divergent
 * 3. All successful -> aggregate all, convergence = divergent
 * 4. Verdict from max severity: critical -> fail, any findings -> pass_with_findings, none -> pass
 * 5. VerdictConvergence: findings exist -> divergent, none -> none
 */
export function aggregateFallback(results: ReviewerOutput[]): FallbackResult {
  // Filter to successful reviewers (no error field, or error is null/undefined)
  const successful = results.filter(
    (r) => r.verdict !== "error" && !r.error,
  );

  // All error or empty input -> fail-secure
  if (successful.length === 0) {
    return {
      verdict: "error",
      convergence: "none",
      findings: [],
      error: FAIL_SECURE_ERROR,
    };
  }

  // Aggregate findings from successful reviewers, marking each as divergent
  const findings: Finding[] = [];
  for (const reviewer of successful) {
    for (const finding of reviewer.findings) {
      findings.push({
        ...finding,
        convergence: "divergent",
        sources: [reviewer.model],
      });
    }
  }

  // Determine verdict from aggregated findings
  let verdict: VerdictValue;
  if (findings.length === 0) {
    verdict = "pass";
  } else if (findings.some((f) => f.severity === "critical")) {
    verdict = "fail";
  } else {
    verdict = "pass_with_findings";
  }

  // VerdictConvergence: findings exist -> divergent, none -> none
  const convergence: VerdictConvergence =
    findings.length > 0 ? "divergent" : "none";

  return {
    verdict,
    convergence,
    findings,
    error: null,
  };
}
