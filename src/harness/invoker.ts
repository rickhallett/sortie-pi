// Reviewer invoker module — SORTIE_PROTOCOL_v3.md Sections 7.2-7.6
// Parses reviewer output and orchestrates parallel reviewer invocations.

import YAML from "yaml";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { ReviewerOutput, VerdictValue, Finding } from "../contracts/types.js";

// ---------------------------------------------------------------------------
// parseReviewerOutput
// ---------------------------------------------------------------------------

/**
 * Strip markdown code fences from raw output.
 * Handles both ```yaml ... ``` and ``` ... ``` forms.
 */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  // Match opening fence (```yaml or ```) and closing fence (```)
  const fencePattern = /^```(?:yaml|yml)?\s*\n([\s\S]*?)\n```\s*$/;
  const match = trimmed.match(fencePattern);
  if (match) {
    return match[1];
  }
  return trimmed;
}

/**
 * Parse raw model output into a ReviewerOutput.
 *
 * 1. Strips markdown fences if present.
 * 2. Parses YAML.
 * 3. Validates required fields (model, verdict, findings).
 * 4. On failure, returns an error ReviewerOutput with the raw text preserved.
 */
export function parseReviewerOutput(raw: string, model: string): ReviewerOutput {
  try {
    const stripped = stripFences(raw);
    const parsed = YAML.parse(stripped);

    if (!parsed || typeof parsed !== "object") {
      return makeErrorOutput(model, raw, "Parsed YAML is not an object");
    }

    // Validate required fields per Section 7.4
    if (!parsed.verdict) {
      return makeErrorOutput(model, raw, "Missing required field: verdict");
    }
    if (!Array.isArray(parsed.findings) && parsed.findings !== undefined) {
      // findings must be an array (or at least present)
      return makeErrorOutput(model, raw, "Missing or invalid required field: findings");
    }
    if (parsed.findings === undefined) {
      return makeErrorOutput(model, raw, "Missing required field: findings");
    }

    const validVerdicts: VerdictValue[] = ["pass", "pass_with_findings", "fail", "error"];
    if (!validVerdicts.includes(parsed.verdict)) {
      return makeErrorOutput(model, raw, `Invalid verdict value: ${parsed.verdict}`);
    }

    const findings: Finding[] = Array.isArray(parsed.findings) ? parsed.findings : [];

    // Validate verdict consistency per Section 7.5
    if (parsed.verdict === "pass" && findings.length > 0) {
      return makeErrorOutput(model, raw, 'Verdict "pass" must have empty findings');
    }
    if (parsed.verdict === "fail" && !findings.some((f: any) => f.severity === "critical")) {
      return makeErrorOutput(model, raw, 'Verdict "fail" requires at least one critical finding');
    }
    if (parsed.verdict === "pass_with_findings" && findings.length === 0) {
      return makeErrorOutput(model, raw, 'Verdict "pass_with_findings" must have at least one finding');
    }

    // Validate individual finding fields
    for (const [i, f] of findings.entries()) {
      if (!f || typeof f !== "object") {
        return makeErrorOutput(model, raw, `findings[${i}]: must be an object`);
      }
      if (typeof f.id !== "string" || !f.id) {
        return makeErrorOutput(model, raw, `findings[${i}].id: must be a non-empty string`);
      }
      if (!["critical", "major", "minor"].includes(f.severity)) {
        return makeErrorOutput(model, raw, `findings[${i}].severity: must be critical, major, or minor`);
      }
      if (typeof f.file !== "string") {
        return makeErrorOutput(model, raw, `findings[${i}].file: must be a string`);
      }
      if (typeof f.line !== "number") {
        return makeErrorOutput(model, raw, `findings[${i}].line: must be a number`);
      }
    }

    return {
      model: parsed.model ?? model,
      verdict: parsed.verdict as VerdictValue,
      findings,
      raw_output: raw,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return makeErrorOutput(model, raw, message);
  }
}

function makeErrorOutput(model: string, raw: string, error: string): ReviewerOutput {
  return {
    model,
    verdict: "error",
    findings: [],
    raw_output: raw,
    error,
  };
}

// ---------------------------------------------------------------------------
// invokeReviewer
// ---------------------------------------------------------------------------

/**
 * Invoke a single reviewer session.
 *
 * 1. Records start time.
 * 2. Calls session.prompt() with the assembled prompt.
 * 3. Gets output via session.getLastAssistantText().
 * 4. Gets stats via session.getSessionStats().
 * 5. Parses output into ReviewerOutput.
 * 6. Attaches tokens, cost, wall_time_ms from stats and timing.
 * 7. If timeout exceeded or any error, returns error ReviewerOutput.
 */
export async function invokeReviewer(
  session: AgentSession,
  prompt: string,
  model: string,
  timeout?: number
): Promise<ReviewerOutput> {
  const startTime = Date.now();

  try {
    if (timeout !== undefined && timeout > 0) {
      // Race the prompt against a timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout: reviewer exceeded time limit")), timeout);
      });
      await Promise.race([session.prompt(prompt), timeoutPromise]);
    } else {
      await session.prompt(prompt);
    }

    const wallTimeMs = Date.now() - startTime;
    const rawText = session.getLastAssistantText();

    if (rawText === undefined || rawText === null) {
      return attachStats(
        makeErrorOutput(model, "", "No assistant response received"),
        session,
        wallTimeMs
      );
    }

    const result = parseReviewerOutput(rawText, model);
    return attachStats(result, session, wallTimeMs);
  } catch (err) {
    const wallTimeMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);
    const errorOutput = makeErrorOutput(model, "", message);
    // Try to get stats even on error — session may still have them
    try {
      return attachStats(errorOutput, session, wallTimeMs);
    } catch {
      return {
        ...errorOutput,
        wall_time_ms: wallTimeMs,
      };
    }
  }
}

function attachStats(
  output: ReviewerOutput,
  session: AgentSession,
  wallTimeMs: number
): ReviewerOutput {
  const stats = session.getSessionStats();
  return {
    ...output,
    tokens: stats.tokens
      ? {
          input: stats.tokens.input,
          output: stats.tokens.output,
          cacheRead: stats.tokens.cacheRead,
          cacheWrite: stats.tokens.cacheWrite,
          total: stats.tokens.total,
        }
      : undefined,
    cost: stats.cost,
    wall_time_ms: wallTimeMs,
  };
}

// ---------------------------------------------------------------------------
// invokeAll
// ---------------------------------------------------------------------------

/**
 * Invoke all reviewers in parallel (Section 7.6).
 *
 * Uses Promise.all() for true parallelism. Each result is independent;
 * one failure does not affect others. Results maintain input order.
 */
export async function invokeAll(
  entries: Array<{ session: AgentSession; prompt: string; model: string; timeout?: number }>
): Promise<ReviewerOutput[]> {
  return Promise.all(
    entries.map((entry) => invokeReviewer(entry.session, entry.prompt, entry.model, entry.timeout))
  );
}
