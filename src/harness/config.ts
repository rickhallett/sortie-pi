// Harness config loader — SORTIE_PROTOCOL_v3.md Section 16

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { Severity } from "../contracts/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RosterEntry {
  name: string;
  provider: string;
  model: string;
  timeout?: number;
}

export interface ModeConfig {
  prompt_template: string;
  roster?: string[];
  debrief_template?: string;
  triage?: TriageOverride;
}

export interface TriageOverride {
  block_on: Severity[];
  convergence_threshold?: number;
  max_remediation_cycles?: number;
}

export interface DebriefConfig {
  model: string;
  provider: string;
  prompt_template: string;
}

export interface SortieConfig {
  definition: string;
  tools: string[];
  can_delegate_to: string[];
  role?: string;
  write_scope?: string;
}

export interface HarnessConfig {
  project: string;
  roster: RosterEntry[];
  debrief: DebriefConfig;
  triage: TriageOverride;
  modes: Record<string, ModeConfig>;
  deposition_dir: string;
  ledger_path: string;
  sorties?: Record<string, SortieConfig>;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load and validate harness config from a YAML file.
 *
 * Required fields: project, roster (non-empty), debrief, triage, modes (at least one).
 * Defaults: deposition_dir = ".sortie", ledger_path = ".sortie/ledger.yaml".
 */
export function loadHarnessConfig(path: string): HarnessConfig {
  const raw = readFileSync(path, "utf-8");
  const doc = parseYaml(raw) as Record<string, unknown>;

  if (!doc || typeof doc !== "object") {
    throw new Error("Invalid YAML: expected a mapping at the top level");
  }

  // --- Required fields ---

  if (!doc.project || typeof doc.project !== "string") {
    throw new Error("Missing required field: project");
  }

  if (!Array.isArray(doc.roster) || doc.roster.length === 0) {
    throw new Error("Missing or empty required field: roster");
  }

  if (!doc.debrief || typeof doc.debrief !== "object") {
    throw new Error("Missing required field: debrief");
  }

  if (!doc.triage || typeof doc.triage !== "object") {
    throw new Error("Missing required field: triage");
  }

  if (
    !doc.modes ||
    typeof doc.modes !== "object" ||
    Array.isArray(doc.modes) ||
    Object.keys(doc.modes as Record<string, unknown>).length === 0
  ) {
    throw new Error("Missing or empty required field: modes");
  }

  // --- Nested field validation ---

  // Roster entries
  for (const [i, r] of (doc.roster as any[]).entries()) {
    if (!r || typeof r !== "object") throw new Error(`roster[${i}]: must be an object`);
    if (typeof r.name !== "string" || !r.name) throw new Error(`roster[${i}].name: must be a non-empty string`);
    if (typeof r.provider !== "string" || !r.provider) throw new Error(`roster[${i}].provider: must be a non-empty string`);
    if (typeof r.model !== "string" || !r.model) throw new Error(`roster[${i}].model: must be a non-empty string`);
    if (r.timeout != null && typeof r.timeout !== "number") throw new Error(`roster[${i}].timeout: must be a number`);
  }

  // Debrief
  const rawDebrief = doc.debrief as Record<string, unknown>;
  if (typeof rawDebrief.model !== "string" || !rawDebrief.model) throw new Error("debrief.model: must be a non-empty string");
  if (typeof rawDebrief.provider !== "string" || !rawDebrief.provider) throw new Error("debrief.provider: must be a non-empty string");
  if (typeof rawDebrief.prompt_template !== "string" || !rawDebrief.prompt_template) throw new Error("debrief.prompt_template: must be a non-empty string");

  // Triage
  const rawTriage = doc.triage as Record<string, unknown>;
  if (!Array.isArray(rawTriage.block_on)) throw new Error("triage.block_on: must be an array");
  for (const [i, s] of (rawTriage.block_on as any[]).entries()) {
    if (typeof s !== "string") throw new Error(`triage.block_on[${i}]: must be a string`);
  }

  // Modes
  const rawModes = doc.modes as Record<string, Record<string, unknown>>;
  for (const [name, m] of Object.entries(rawModes)) {
    if (!m || typeof m !== "object") throw new Error(`modes.${name}: must be an object`);
    if (typeof m.prompt_template !== "string" || !m.prompt_template) throw new Error(`modes.${name}.prompt_template: must be a non-empty string`);
    if (m.roster != null && (!Array.isArray(m.roster) || !m.roster.every((r: any) => typeof r === "string"))) throw new Error(`modes.${name}.roster: must be a string array`);
  }

  // --- Build config with defaults ---

  const roster: RosterEntry[] = (doc.roster as Record<string, unknown>[]).map((r) => ({
    name: r.name as string,
    provider: r.provider as string,
    model: r.model as string,
    ...(r.timeout != null ? { timeout: r.timeout as number } : {}),
  }));

  const debrief = doc.debrief as DebriefConfig;

  const triage: TriageOverride = {
    block_on: rawTriage.block_on as Severity[],
    ...(rawTriage.convergence_threshold != null
      ? { convergence_threshold: rawTriage.convergence_threshold as number }
      : {}),
    ...(rawTriage.max_remediation_cycles != null
      ? { max_remediation_cycles: rawTriage.max_remediation_cycles as number }
      : {}),
  };

  const modes: Record<string, ModeConfig> = {};
  for (const [name, m] of Object.entries(rawModes)) {
    const mode: ModeConfig = {
      prompt_template: m.prompt_template as string,
    };
    if (m.roster != null) {
      mode.roster = m.roster as string[];
    }
    if (m.debrief_template != null) {
      mode.debrief_template = m.debrief_template as string;
    }
    if (m.triage != null) {
      const mt = m.triage as Record<string, unknown>;
      mode.triage = {
        block_on: mt.block_on as Severity[],
        ...(mt.convergence_threshold != null
          ? { convergence_threshold: mt.convergence_threshold as number }
          : {}),
        ...(mt.max_remediation_cycles != null
          ? { max_remediation_cycles: mt.max_remediation_cycles as number }
          : {}),
      };
    }
    modes[name] = mode;
  }

  // Sorties (optional)
  let sorties: Record<string, SortieConfig> | undefined;
  if (doc.sorties != null) {
    if (typeof doc.sorties !== "object" || Array.isArray(doc.sorties)) {
      throw new Error("sorties: must be a mapping");
    }
    sorties = {};
    for (const [name, entry] of Object.entries(doc.sorties as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`sorties.${name}: must be an object`);
      }
      const e = entry as Record<string, unknown>;
      if (typeof e.definition !== "string" || !e.definition) {
        throw new Error(`sorties.${name}.definition: must be a non-empty string`);
      }
      if (!Array.isArray(e.tools) || !e.tools.every((t: unknown) => typeof t === "string")) {
        throw new Error(`sorties.${name}.tools: must be a string array`);
      }
      if (!Array.isArray(e.can_delegate_to) || !e.can_delegate_to.every((t: unknown) => typeof t === "string")) {
        throw new Error(`sorties.${name}.can_delegate_to: must be a string array`);
      }
      const sortieEntry: SortieConfig = {
        definition: e.definition,
        tools: e.tools as string[],
        can_delegate_to: e.can_delegate_to as string[],
      };
      if (e.role != null) {
        if (typeof e.role !== "string") throw new Error(`sorties.${name}.role: must be a string`);
        sortieEntry.role = e.role;
      }
      if (e.write_scope != null) {
        if (typeof e.write_scope !== "string") throw new Error(`sorties.${name}.write_scope: must be a string`);
        sortieEntry.write_scope = e.write_scope;
      }
      sorties[name] = sortieEntry;
    }
  }

  return {
    project: doc.project as string,
    roster,
    debrief,
    triage,
    modes,
    deposition_dir: (doc.deposition_dir as string) ?? ".sortie",
    ledger_path: (doc.ledger_path as string) ?? ".sortie/ledger.yaml",
    ...(sorties ? { sorties } : {}),
  };
}
