import type { Finding, TriageConfig, TriageResult } from "./types.js";

const ALL_CLEAR_WARNING =
  "Zero findings across all reviewers — verify review depth";

/**
 * Evaluate findings against triage configuration and return a merge-gating decision.
 *
 * Decision logic (Section 9.4):
 * 1. Only convergent findings MAY block. Divergent findings are always advisory.
 * 2. A convergent finding blocks only if its severity is in block_on.
 * 3. Action determination:
 *    - Any blocking finding exists: action="block", exit_code=1
 *    - Findings exist but none block: action="merge_with_findings", exit_code=2
 *    - No findings: action="merge", exit_code=0
 */
export function triageVerdict(
  findings: Finding[],
  config: TriageConfig,
): TriageResult {
  // No findings — clean merge with all-clear warning
  if (findings.length === 0) {
    return {
      action: "merge",
      exit_code: 0,
      blocking_findings: [],
      advisory_findings: [],
      all_clear_warning: ALL_CLEAR_WARNING,
    };
  }

  const blockOnSet = new Set(config.block_on);

  // Partition findings: only convergent findings whose severity is in block_on can block
  const blocking: Finding[] = [];
  const advisory: Finding[] = [];

  for (const finding of findings) {
    if (
      finding.convergence === "convergent" &&
      blockOnSet.has(finding.severity)
    ) {
      blocking.push(finding);
    } else {
      advisory.push(finding);
    }
  }

  // Determine action and exit code
  if (blocking.length > 0) {
    return {
      action: "block",
      exit_code: 1,
      blocking_findings: blocking,
      advisory_findings: advisory,
    };
  }

  return {
    action: "merge_with_findings",
    exit_code: 2,
    blocking_findings: [],
    advisory_findings: advisory,
  };
}
