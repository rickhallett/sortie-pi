import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parse, stringify } from "yaml";
import type { LedgerEntry, Disposition } from "./types.js";

/**
 * Compute summary fields from the findings array of a LedgerEntry.
 */
export function computeSummary(
  entry: LedgerEntry,
): Pick<
  LedgerEntry,
  | "findings_total"
  | "findings_convergent"
  | "findings_divergent"
  | "by_severity"
  | "dispositions"
> {
  const findings = entry.findings ?? [];

  const findings_total = findings.length;
  let findings_convergent = 0;
  let findings_divergent = 0;
  const by_severity = { critical: 0, major: 0, minor: 0 };
  const dispositions: Record<Disposition, number> = {
    fixed: 0,
    "false-positive": 0,
    deferred: 0,
    disagree: 0,
  };

  for (const f of findings) {
    if (f.convergence === "convergent") findings_convergent++;
    if (f.convergence === "divergent") findings_divergent++;

    if (f.severity in by_severity) {
      by_severity[f.severity]++;
    }

    if (f.disposition && f.disposition in dispositions) {
      dispositions[f.disposition]++;
    }
  }

  return {
    findings_total,
    findings_convergent,
    findings_divergent,
    by_severity,
    dispositions,
  };
}

/**
 * Append-only YAML ledger for Sortie run history.
 * Spec: SORTIE_PROTOCOL_v3.md Section 12.2
 */
export class Ledger {
  private data: { runs: LedgerEntry[] } | null = null;

  constructor(private filePath: string) {}

  /**
   * Parse YAML from disk. Missing file = { runs: [] }.
   */
  load(): { runs: LedgerEntry[] } {
    if (this.data) return this.data;

    if (!existsSync(this.filePath)) {
      this.data = { runs: [] };
      return this.data;
    }

    const raw = readFileSync(this.filePath, "utf-8");
    const parsed = parse(raw);

    if (!parsed || !parsed.runs) {
      this.data = { runs: [] };
    } else {
      this.data = parsed as { runs: LedgerEntry[] };
    }

    return this.data;
  }

  /**
   * Add a run entry and persist atomically (write full file).
   */
  append(entry: LedgerEntry): void {
    const data = this.load();
    data.runs.push(entry);
    this.persist();
  }

  /**
   * Retrieve a run by tree_sha + cycle identity.
   */
  findRun(treeSha: string, cycle: number): LedgerEntry | undefined {
    const data = this.load();
    return data.runs.find(
      (r) => r.tree_sha === treeSha && r.cycle === cycle,
    );
  }

  /**
   * Query runs by branch name.
   */
  runsForBranch(branch: string): LedgerEntry[] {
    const data = this.load();
    return data.runs.filter((r) => r.branch === branch);
  }

  /**
   * Update one finding's disposition and recompute summary dispositions field.
   * Persists immediately.
   */
  updateDisposition(
    treeSha: string,
    cycle: number,
    findingId: string,
    disposition: Disposition,
  ): void {
    const run = this.findRun(treeSha, cycle);
    if (!run) {
      throw new Error(
        `Run not found: tree_sha=${treeSha}, cycle=${cycle}`,
      );
    }

    const finding = run.findings.find((f) => f.id === findingId);
    if (!finding) {
      throw new Error(
        `Finding not found: id=${findingId} in run tree_sha=${treeSha}, cycle=${cycle}`,
      );
    }

    finding.disposition = disposition;

    // Recompute summary fields
    const summary = computeSummary(run);
    run.dispositions = summary.dispositions;
    run.findings_total = summary.findings_total;
    run.findings_convergent = summary.findings_convergent;
    run.findings_divergent = summary.findings_divergent;
    run.by_severity = summary.by_severity;

    this.persist();
  }

  /**
   * Update all findings in a run to the given disposition.
   * Persists immediately.
   */
  bulkDispose(
    treeSha: string,
    cycle: number,
    disposition: Disposition,
  ): void {
    const run = this.findRun(treeSha, cycle);
    if (!run) {
      throw new Error(
        `Run not found: tree_sha=${treeSha}, cycle=${cycle}`,
      );
    }

    for (const finding of run.findings) {
      finding.disposition = disposition;
    }

    // Recompute summary fields
    const summary = computeSummary(run);
    run.dispositions = summary.dispositions;
    run.findings_total = summary.findings_total;
    run.findings_convergent = summary.findings_convergent;
    run.findings_divergent = summary.findings_divergent;
    run.by_severity = summary.by_severity;

    this.persist();
  }

  /**
   * Write the full ledger to disk atomically.
   */
  private persist(): void {
    const data = this.load();
    const yaml = stringify(data);
    writeFileSync(this.filePath, yaml, "utf-8");
  }
}
