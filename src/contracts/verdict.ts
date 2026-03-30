import { stringify, parse } from "yaml";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Verdict, Disposition } from "./types.js";

const VERDICT_FILENAME = "verdict.yaml";

/**
 * Write verdict.yaml to the run directory.
 * Creates the directory if it does not exist.
 */
export function writeVerdict(runPath: string, verdict: Verdict): void {
  mkdirSync(runPath, { recursive: true });
  const filePath = join(runPath, VERDICT_FILENAME);
  writeFileSync(filePath, stringify(verdict), "utf-8");
}

/**
 * Read and parse verdict.yaml from the run directory.
 * Returns null if the file or directory does not exist.
 */
export function readVerdict(runPath: string): Verdict | null {
  const filePath = join(runPath, VERDICT_FILENAME);
  if (!existsSync(filePath)) {
    return null;
  }

  const raw = readFileSync(filePath, "utf-8");
  const parsed = parse(raw);

  if (parsed && typeof parsed === "object" && "verdict" in parsed) {
    return parsed as Verdict;
  }
  throw new Error(`Corrupt verdict file: ${filePath} — missing required 'verdict' field`);
}

/**
 * Update a single finding's disposition in verdict.yaml.
 * Reads the verdict, finds the finding by id, sets its disposition, and writes back.
 * Throws if the verdict file is missing or the finding ID is not found.
 */
export function updateFindingDisposition(
  runPath: string,
  findingId: string,
  disposition: Disposition,
): void {
  const verdict = readVerdict(runPath);
  if (!verdict) {
    throw new Error(`No verdict.yaml found at ${runPath}`);
  }

  const finding = verdict.findings.find((f) => f.id === findingId);
  if (!finding) {
    throw new Error(
      `Finding with id "${findingId}" not found in verdict at ${runPath}`,
    );
  }

  finding.disposition = disposition;
  writeVerdict(runPath, verdict);
}
