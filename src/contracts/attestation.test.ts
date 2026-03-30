import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";
import { loadFixture } from "../test-support/load-fixture.js";
import type { Attestation } from "./types.js";
import {
  writeAttestation,
  readAttestation,
  verifyAttestations,
} from "./attestation.js";

const sampleAttestation: Attestation = {
  step: "sortie-claude-sonnet-4-20250514",
  tree_sha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
  cycle: 1,
  verdict: "pass",
  findings_count: 0,
  tokens: 1350,
  wall_time_ms: 2300,
  timestamp: "2026-03-30T12:00:00Z",
};

describe("writeAttestation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sortie-attestation-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates file at correct path", () => {
    writeAttestation(tmpDir, sampleAttestation);
    const expectedPath = join(tmpDir, "attestations", "sortie-claude-sonnet-4-20250514.yaml");
    expect(existsSync(expectedPath)).toBe(true);
  });
});

describe("readAttestation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sortie-attestation-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("reads back what was written (roundtrip)", () => {
    writeAttestation(tmpDir, sampleAttestation);
    const result = readAttestation(tmpDir, sampleAttestation.step);
    expect(result).toEqual(sampleAttestation);
  });

  test("returns null for non-existent step", () => {
    const result = readAttestation(tmpDir, "nonexistent-step");
    expect(result).toBeNull();
  });
});

describe("verifyAttestations", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sortie-attestation-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty array when all steps present", () => {
    const steps = ["reviewer-a", "reviewer-b", "debrief"];
    for (const step of steps) {
      writeAttestation(tmpDir, {
        ...sampleAttestation,
        step,
      });
    }
    const missing = verifyAttestations(tmpDir, steps);
    expect(missing).toEqual([]);
  });

  test("returns missing step names", () => {
    writeAttestation(tmpDir, { ...sampleAttestation, step: "reviewer-a" });
    writeAttestation(tmpDir, { ...sampleAttestation, step: "debrief" });
    const missing = verifyAttestations(tmpDir, ["reviewer-a", "reviewer-b", "debrief"]);
    expect(missing).toEqual(["reviewer-b"]);
  });

  test("returns all steps when attestations dir is empty", () => {
    const requiredSteps = ["reviewer-a", "reviewer-b", "debrief"];
    const missing = verifyAttestations(tmpDir, requiredSteps);
    expect(missing).toEqual(requiredSteps);
  });
});

describe("fixture schema match", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sortie-attestation-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("written attestation matches fixture schema", () => {
    const fixture = loadFixture<Attestation>("attestations/reviewer-attestation.yaml");

    // Write the fixture data
    writeAttestation(tmpDir, fixture);

    // Read the raw YAML back and parse it
    const filePath = join(tmpDir, "attestations", `${fixture.step}.yaml`);
    const raw = readFileSync(filePath, "utf-8");
    const parsed = parse(raw) as Attestation;

    // Verify all required fields match
    expect(parsed.step).toBe(fixture.step);
    expect(parsed.tree_sha).toBe(fixture.tree_sha);
    expect(parsed.cycle).toBe(fixture.cycle);
    expect(parsed.verdict).toBe(fixture.verdict);
    expect(parsed.findings_count).toBe(fixture.findings_count);
    expect(parsed.tokens).toBe(fixture.tokens);
    expect(parsed.wall_time_ms).toBe(fixture.wall_time_ms);
    expect(parsed.timestamp).toBe(fixture.timestamp);

    // Verify all required keys are present
    const requiredKeys: (keyof Attestation)[] = [
      "step",
      "tree_sha",
      "cycle",
      "verdict",
      "findings_count",
      "tokens",
      "wall_time_ms",
      "timestamp",
    ];
    for (const key of requiredKeys) {
      expect(parsed).toHaveProperty(key);
    }
  });
});
