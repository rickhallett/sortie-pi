// Protocol types — sortie_protocol_v3.md Sections 7, 8, 9, 12

export type Severity = "critical" | "major" | "minor";
export type Convergence = "convergent" | "divergent";
export type VerdictConvergence = "convergent" | "divergent" | "mixed" | "none";
export type VerdictValue = "pass" | "pass_with_findings" | "fail" | "error";
export type Disposition = "fixed" | "false-positive" | "deferred" | "disagree";
export type TriageAction = "merge" | "merge_with_findings" | "block";

export interface Finding {
  id: string;
  severity: Severity;
  file: string;
  line: number;
  category: string;
  summary: string;
  detail: string;
  convergence?: Convergence;
  sources?: string[];
  disposition?: Disposition | null;
}

export interface ReviewerOutput {
  model: string;
  verdict: VerdictValue;
  findings: Finding[];
  tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
  cost?: number;
  wall_time_ms?: number;
  raw_output?: string;
  error?: string | null;
}

export interface Verdict {
  verdict: VerdictValue;
  convergence: VerdictConvergence;
  findings: Finding[];
  tree_sha: string;
  cycle: number;
  run_id: string;
  branch: string;
  mode: string;
  diff_stats?: Record<string, unknown>;
  debrief_model?: string;
  roster?: string[];
  tokens?: Record<string, unknown>;
  wall_time_ms?: number;
  error?: string | null;
}

export interface TriageResult {
  action: TriageAction;
  exit_code: 0 | 1 | 2;
  blocking_findings: Finding[];
  advisory_findings: Finding[];
  all_clear_warning?: string | null;
}

export interface TriageConfig {
  block_on: Severity[];
  convergence_threshold?: number;
  max_remediation_cycles?: number;
}

export interface Attestation {
  step: string;
  tree_sha: string;
  cycle: number;
  verdict: VerdictValue;
  findings_count: number;
  tokens: number | Record<string, number>;
  wall_time_ms: number;
  timestamp: string;
}

export interface LedgerEntry {
  run_id: string;
  tree_sha: string;
  cycle: number;
  timestamp: string;
  project: string;
  branch: string;
  worker_branch: string;
  mode: string;
  verdict: VerdictValue;
  convergence: string;
  debrief_model: string;
  roster_used: string[];
  model_status: Record<string, {
    verdict: VerdictValue;
    error?: string | null;
    findings_count: number;
    wall_time_ms: number;
    tokens: Record<string, number>;
  }>;
  findings: Finding[];
  diff_stats: { files?: number; insertions?: number; deletions?: number; raw?: string };
  wall_time_ms: number;
  tokens: { by_model: Record<string, Record<string, number>>; total: number };
  findings_total: number;
  findings_convergent: number;
  findings_divergent: number;
  by_severity: { critical: number; major: number; minor: number };
  dispositions: Record<Disposition, number>;
}
