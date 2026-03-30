// Validation pipeline — SORTIE_PROTOCOL_v3.md Section 10
// Orchestrates the full validation lifecycle: Steps 1-11.
//
// This is a stub defining the public API contract.
// Implementation will be written against tests authored separately.

import type { HarnessConfig } from "../harness/config.js";
import type {
  Verdict,
  TriageResult,
  ReviewerOutput,
  LedgerEntry,
} from "../contracts/types.js";
import type { RunSummary } from "../harness/events.js";

// ---------------------------------------------------------------------------
// Pipeline input
// ---------------------------------------------------------------------------

export interface PipelineInput {
  /** Loaded harness configuration. */
  config: HarnessConfig;

  /** Working directory (repository root). */
  cwd: string;

  /** Git branch name (e.g., "feat/foo"). */
  branch: string;

  /** Review mode key from config.modes (e.g., "code", "tests"). */
  mode: string;

  /**
   * Pre-computed diff string (base...branch).
   * If undefined, the pipeline computes it via git.
   * Provided for testability — tests inject a known diff.
   */
  diff?: string;
}

// ---------------------------------------------------------------------------
// Pipeline result
// ---------------------------------------------------------------------------

export interface PipelineResult {
  /** Triage exit code: 0 (merge), 1 (block/error), 2 (merge with findings). */
  exit_code: 0 | 1 | 2;

  /** Run ID ({tree_sha_8}-{cycle}). */
  run_id: string;

  /** Path to the run directory (.sortie/{run_id}/). */
  run_dir: string;

  /** Consolidated verdict artifact. */
  verdict: Verdict;

  /** Triage decision. */
  triage: TriageResult;

  /** Per-reviewer raw outputs (order matches roster). */
  reviewer_outputs: ReviewerOutput[];

  /** Whether debrief used the deterministic fallback. */
  debrief_fallback: boolean;

  /** Ledger entry that was appended. */
  ledger_entry: LedgerEntry;

  /** Aggregated run statistics (tokens, cost, wall time). */
  summary: RunSummary;
}

// ---------------------------------------------------------------------------
// Pipeline errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the diff is empty (Step 1).
 * Callers should treat this as exit code 0 — nothing to review.
 */
export class EmptyDiffError extends Error {
  constructor() {
    super("Diff is empty — nothing to review");
    this.name = "EmptyDiffError";
  }
}

/**
 * Thrown when the requested mode is not found in config.modes.
 */
export class UnknownModeError extends Error {
  constructor(mode: string) {
    super(`Unknown review mode: "${mode}"`);
    this.name = "UnknownModeError";
  }
}

// ---------------------------------------------------------------------------
// Pipeline function
// ---------------------------------------------------------------------------

/**
 * Execute the full validation pipeline (Section 10, Steps 1-11).
 *
 * Steps:
 *  1. Diff — compute or use provided diff. Throw EmptyDiffError if empty.
 *  2. Identity — tree SHA, cycle, run ID.
 *  3. Create run directory — {deposition_dir}/{run_id}/attestations/
 *  4. Resolve mode — lookup config.modes[mode]. Throw UnknownModeError if missing.
 *  5. Invoke reviewers — parallel, write per-reviewer artifacts + attestations.
 *  6. Debrief — invoke debrief model, or fallback aggregation on failure.
 *  7. Fail-secure — if all reviewers errored, verdict=error, exit_code=1.
 *  8. Write verdict — verdict.yaml + debrief attestation.
 *  9. Triage — evaluate verdict against triage config.
 * 10. Ledger — append run entry.
 * 11. Return PipelineResult with exit_code.
 *
 * @throws EmptyDiffError — diff is empty, nothing to review (exit 0)
 * @throws UnknownModeError — mode not found in config
 */
export async function runPipeline(
  _input: PipelineInput,
): Promise<PipelineResult> {
  throw new Error("Not implemented — stub for test authoring");
}
