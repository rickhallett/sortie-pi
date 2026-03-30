// Validation pipeline — SORTIE_PROTOCOL_v3.md Section 10
// Orchestrates the full validation lifecycle: Steps 1-11.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify } from "yaml";

import {
  getTreeSha,
  treeSha8,
  nextCycle,
  runId as makeRunId,
  runDir as makeRunDir,
} from "../contracts/identity.js";
import { aggregateFallback } from "../contracts/debrief.js";
import { triageVerdict } from "../contracts/triage.js";
import { Ledger, computeSummary } from "../contracts/ledger.js";
import { writeVerdict } from "../contracts/verdict.js";
import { writeAttestation } from "../contracts/attestation.js";
import type {
  Verdict,
  TriageResult,
  ReviewerOutput,
  LedgerEntry,
  Finding,
} from "../contracts/types.js";

import type { HarnessConfig, ModeConfig } from "../harness/config.js";
import { createReviewerSession, createLeadSession } from "../harness/session-factory.js";
import { createDomainLock } from "../harness/domain-lock.js";
import { invokeAll } from "../harness/invoker.js";
import {
  assembleReviewerPrompt,
  assembleDebriefPrompt,
  loadTemplate,
} from "../harness/prompt.js";
import { RunEventEmitter, type RunSummary } from "../harness/events.js";
import { sortieCustomTools } from "../tools/index.js";

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

export class EmptyDiffError extends Error {
  constructor() {
    super("Diff is empty — nothing to review");
    this.name = "EmptyDiffError";
  }
}

export class UnknownModeError extends Error {
  constructor(mode: string) {
    super(`Unknown review mode: "${mode}"`);
    this.name = "UnknownModeError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeDiff(cwd: string, branch: string): string {
  try {
    return execFileSync(
      "git",
      ["diff", "--merge-base", "origin/main", branch],
      { cwd, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
    ).trim();
  } catch {
    return "";
  }
}

function resolveRoster(config: HarnessConfig, modeConfig: ModeConfig) {
  const rosterNames = modeConfig.roster ?? config.roster.map((r) => r.name);
  return rosterNames.map((name) => {
    const entry = config.roster.find((r) => r.name === name);
    if (!entry) throw new Error(`Roster entry not found: ${name}`);
    return entry;
  });
}

function buildModelStatus(
  rosterEntries: HarnessConfig["roster"],
  reviewerOutputs: ReviewerOutput[],
): LedgerEntry["model_status"] {
  const status: LedgerEntry["model_status"] = {};
  for (let i = 0; i < rosterEntries.length; i++) {
    const entry = rosterEntries[i];
    const output = reviewerOutputs[i];
    status[entry.name] = {
      verdict: output.verdict,
      error: output.error ?? null,
      findings_count: output.findings.length,
      wall_time_ms: output.wall_time_ms ?? 0,
      tokens: {
        input: output.tokens?.input ?? 0,
        output: output.tokens?.output ?? 0,
        total: output.tokens?.total ?? 0,
      },
    };
  }
  return status;
}

function buildTokensSummary(
  rosterEntries: HarnessConfig["roster"],
  reviewerOutputs: ReviewerOutput[],
): LedgerEntry["tokens"] {
  const byModel: Record<string, Record<string, number>> = {};
  let total = 0;
  for (let i = 0; i < rosterEntries.length; i++) {
    const entry = rosterEntries[i];
    const output = reviewerOutputs[i];
    const t = output.tokens?.total ?? 0;
    byModel[entry.name] = {
      input: output.tokens?.input ?? 0,
      output: output.tokens?.output ?? 0,
      total: t,
    };
    total += t;
  }
  return { by_model: byModel, total };
}

// ---------------------------------------------------------------------------
// Pipeline function
// ---------------------------------------------------------------------------

export async function runPipeline(
  input: PipelineInput,
): Promise<PipelineResult> {
  const { config, cwd, branch, mode } = input;
  const events = new RunEventEmitter();
  const pipelineStart = new Date().toISOString();

  // --- Step 1: Diff ---
  const diff = input.diff ?? computeDiff(cwd, branch);
  if (!diff.trim()) {
    throw new EmptyDiffError();
  }

  // --- Step 4 (early): Resolve mode ---
  const modeConfig = config.modes[mode];
  if (!modeConfig) {
    throw new UnknownModeError(mode);
  }

  // --- Step 2: Identity ---
  const treeSha = getTreeSha(cwd);
  const sha8 = treeSha8(treeSha);
  const depositionDir = join(cwd, config.deposition_dir);
  const cycle = nextCycle(depositionDir, sha8);
  const runIdStr = makeRunId(treeSha, cycle);
  const runDirPath = makeRunDir(depositionDir, treeSha, cycle);

  // --- Step 3: Create run directory ---
  mkdirSync(join(runDirPath, "attestations"), { recursive: true });

  // --- Step 4: Resolve roster for mode ---
  const rosterEntries = resolveRoster(config, modeConfig);

  // --- Load templates ---
  const reviewerTemplate = await loadTemplate(join(cwd, modeConfig.prompt_template));
  const debriefTemplatePath = modeConfig.debrief_template ?? config.debrief.prompt_template;
  const debriefTemplate = await loadTemplate(join(cwd, debriefTemplatePath));

  // --- Step 5: Invoke reviewers in parallel ---
  const reviewerSessions = await Promise.all(
    rosterEntries.map((entry) => createReviewerSession(entry, { cwd })),
  );

  const reviewerPrompt = assembleReviewerPrompt(reviewerTemplate, diff, branch);

  const reviewerOutputs = await invokeAll(
    rosterEntries.map((entry, i) => ({
      session: reviewerSessions[i].session,
      prompt: reviewerPrompt,
      model: entry.model,
      timeout: entry.timeout,
    })),
  );

  // Write per-reviewer artifacts and attestations
  for (let i = 0; i < rosterEntries.length; i++) {
    const entry = rosterEntries[i];
    const output = reviewerOutputs[i];

    // Reviewer artifact — write the essential fields (not raw_output to avoid bloat)
    const artifact: Record<string, unknown> = {
      model: output.model,
      verdict: output.verdict,
      findings: output.findings,
      tokens: output.tokens ?? null,
      cost: output.cost ?? null,
      wall_time_ms: output.wall_time_ms ?? null,
      error: output.error ?? null,
    };
    writeFileSync(
      join(runDirPath, `sortie-${entry.name}.yaml`),
      stringify(artifact),
      "utf-8",
    );

    // Reviewer attestation
    writeAttestation(runDirPath, {
      step: `sortie-${entry.name}`,
      tree_sha: treeSha,
      cycle,
      verdict: output.verdict,
      findings_count: output.findings.length,
      tokens: output.tokens?.total ?? 0,
      wall_time_ms: output.wall_time_ms ?? 0,
      timestamp: new Date().toISOString(),
    });

    // Emit event
    events.emit({
      type: output.verdict === "error" ? "reviewer:error" : "reviewer:complete",
      step: `reviewer:${entry.name}`,
      timestamp: new Date().toISOString(),
      tokens: output.tokens?.total,
      cost: output.cost,
      duration_ms: output.wall_time_ms,
      error: output.error ?? undefined,
    });

    // Dispose session
    reviewerSessions[i].dispose();
  }

  // --- Step 6: Debrief ---
  let verdict: Verdict;
  let debriefFallback = false;
  let debriefTokens = 0;
  let debriefCost = 0;
  let debriefWallTimeMs = 0;

  const allErrored = reviewerOutputs.every((o) => o.verdict === "error");

  if (allErrored) {
    // Total failure — skip debrief, use fallback directly (Section 11.3)
    debriefFallback = true;
    const fallback = aggregateFallback(reviewerOutputs);
    verdict = {
      verdict: fallback.verdict,
      convergence: fallback.convergence,
      findings: fallback.findings,
      tree_sha: treeSha,
      cycle,
      run_id: runIdStr,
      branch,
      mode,
      debrief_model: config.debrief.model,
      roster: rosterEntries.map((e) => e.name),
      error: fallback.error,
    };
  } else {
    // Try debrief model
    // Assemble debrief prompt with reviewer outputs
    const sortieOutputs = reviewerOutputs.map(
      (output) => `### ${output.model}\n${output.raw_output ?? ""}`,
    );
    const debriefPrompt = assembleDebriefPrompt(
      debriefTemplate,
      sortieOutputs,
      treeSha,
      branch,
      rosterEntries.length,
    );

    // Create domain lock scoped to this run's directory (VULN-003)
    // NOTE: The returned checker is not yet wired into SDK built-in tools
    // because the Pi SDK lacks a public beforeToolCall hook. See backlog.yml.
    createDomainLock(
      [`${config.deposition_dir}/${runIdStr}/**`],
      cwd,
    );

    // Create lead session — dispose in finally to prevent leak (ISSUE-003)
    const { session: leadSession, dispose: disposeLead } = await createLeadSession(
      config.debrief,
      { cwd, customTools: sortieCustomTools },
    );

    try {
      events.emit({
        type: "debrief:start",
        step: "debrief",
        timestamp: new Date().toISOString(),
      });

      const debriefStart = Date.now();
      await leadSession.prompt(debriefPrompt);
      const debriefWallMs = Date.now() - debriefStart;
      const debriefResponse = leadSession.getLastAssistantText();

      // Capture lead session metrics (ISSUE-004)
      const leadStats = leadSession.getSessionStats();
      debriefTokens = leadStats.tokens?.total ?? 0;
      debriefCost = leadStats.cost ?? 0;
      debriefWallTimeMs = debriefWallMs;

      // Parse debrief response as verdict
      const parsed = parseYaml(debriefResponse ?? "") as Record<string, unknown>;
      verdict = {
        verdict: (parsed.verdict as Verdict["verdict"]) ?? "error",
        convergence: (parsed.convergence as Verdict["convergence"]) ?? "none",
        findings: (parsed.findings as Finding[]) ?? [],
        tree_sha: treeSha,
        cycle,
        run_id: runIdStr,
        branch,
        mode,
        debrief_model: (parsed.debrief_model as string) ?? config.debrief.model,
        roster: (parsed.roster as string[]) ?? rosterEntries.map((e) => e.name),
        error: (parsed.error as string | null) ?? null,
      };

      events.emit({
        type: "debrief:complete",
        step: "debrief",
        timestamp: new Date().toISOString(),
        tokens: debriefTokens,
        cost: debriefCost,
        duration_ms: debriefWallTimeMs,
      });
    } catch (err) {
      // Debrief failed — use deterministic fallback (Section 8.6)
      debriefFallback = true;
      const fallback = aggregateFallback(reviewerOutputs);
      verdict = {
        verdict: fallback.verdict,
        convergence: fallback.convergence,
        findings: fallback.findings,
        tree_sha: treeSha,
        cycle,
        run_id: runIdStr,
        branch,
        mode,
        debrief_model: config.debrief.model,
        roster: rosterEntries.map((e) => e.name),
        error: fallback.error,
      };

      events.emit({
        type: "debrief:error",
        step: "debrief",
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      disposeLead();
    }
  }

  // --- Step 7: Fail-secure check ---
  // If verdict is error, force block (exit 1). Section 11.3.
  if (verdict.verdict === "error" && !verdict.error) {
    verdict.error = "Pipeline failed: all reviewers errored -- blocking merge (fail-secure)";
  }

  // --- Step 8: Write verdict + debrief attestation ---
  writeVerdict(runDirPath, verdict);

  writeAttestation(runDirPath, {
    step: "debrief",
    tree_sha: treeSha,
    cycle,
    verdict: verdict.verdict,
    findings_count: verdict.findings.length,
    tokens: debriefTokens,
    wall_time_ms: debriefWallTimeMs,
    timestamp: new Date().toISOString(),
  });

  // --- Step 9: Triage ---
  let triageResult: TriageResult;
  if (verdict.verdict === "error") {
    // Error verdict always blocks (Section 9.7)
    triageResult = {
      action: "block",
      exit_code: 1,
      blocking_findings: [],
      advisory_findings: verdict.findings,
    };
  } else {
    triageResult = triageVerdict(verdict.findings, config.triage);
  }

  // --- Step 10: Ledger ---
  const ledgerDir = join(cwd, config.deposition_dir);
  mkdirSync(ledgerDir, { recursive: true });
  const ledger = new Ledger(join(cwd, config.ledger_path));

  const ledgerEntry: LedgerEntry = {
    run_id: runIdStr,
    tree_sha: treeSha,
    cycle,
    timestamp: new Date().toISOString(),
    project: config.project,
    branch,
    worker_branch: branch,
    mode,
    verdict: verdict.verdict,
    convergence: verdict.convergence,
    debrief_model: config.debrief.model,
    roster_used: rosterEntries.map((e) => e.name),
    model_status: buildModelStatus(rosterEntries, reviewerOutputs),
    findings: verdict.findings,
    diff_stats: { files: 0, insertions: 0, deletions: 0 },
    wall_time_ms: 0,
    tokens: {
      ...buildTokensSummary(rosterEntries, reviewerOutputs),
      total: buildTokensSummary(rosterEntries, reviewerOutputs).total + debriefTokens,
    },
    findings_total: 0,
    findings_convergent: 0,
    findings_divergent: 0,
    by_severity: { critical: 0, major: 0, minor: 0 },
    dispositions: { fixed: 0, "false-positive": 0, deferred: 0, disagree: 0 },
  };

  // Compute summary fields from findings
  const summary = computeSummary(ledgerEntry);
  ledgerEntry.findings_total = summary.findings_total;
  ledgerEntry.findings_convergent = summary.findings_convergent;
  ledgerEntry.findings_divergent = summary.findings_divergent;
  ledgerEntry.by_severity = summary.by_severity;
  ledgerEntry.dispositions = summary.dispositions;

  ledger.append(ledgerEntry);

  // --- Step 11: Emit pipeline complete and return ---
  events.emit({
    type: "pipeline:complete",
    step: "pipeline",
    timestamp: new Date().toISOString(),
  });

  const runSummary = events.getSummary();

  return {
    exit_code: triageResult.exit_code,
    run_id: runIdStr,
    run_dir: runDirPath,
    verdict,
    triage: triageResult,
    reviewer_outputs: reviewerOutputs,
    debrief_fallback: debriefFallback,
    ledger_entry: ledgerEntry,
    summary: runSummary,
  };
}
