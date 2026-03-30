// Attestation read/write — sortie_protocol_v3.md Section 12.1

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { Attestation } from "./types.js";

/**
 * Write an attestation to {runPath}/attestations/{step}.yaml
 */
export function writeAttestation(runPath: string, attestation: Attestation): void {
  const dir = join(runPath, "attestations");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${attestation.step}.yaml`);
  writeFileSync(filePath, stringify(attestation), "utf-8");
}

/**
 * Read and parse an attestation file. Returns null if missing.
 */
export function readAttestation(runPath: string, step: string): Attestation | null {
  const filePath = join(runPath, "attestations", `${step}.yaml`);
  if (!existsSync(filePath)) {
    return null;
  }
  const raw = readFileSync(filePath, "utf-8");
  return parse(raw) as Attestation;
}

/**
 * Return list of missing steps from the attestations directory.
 */
export function verifyAttestations(runPath: string, requiredSteps: string[]): string[] {
  const dir = join(runPath, "attestations");
  let presentSteps: Set<string>;

  if (!existsSync(dir)) {
    presentSteps = new Set();
  } else {
    const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
    presentSteps = new Set(files.map((f) => f.replace(/\.yaml$/, "")));
  }

  return requiredSteps.filter((step) => !presentSteps.has(step));
}
