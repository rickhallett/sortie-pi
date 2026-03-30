import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { loadFixture } from "../test-support/load-fixture.js";
import type { LedgerEntry } from "../contracts/types.js";
import { runStatusCommand } from "./status.js";

interface BufferWriter {
  write(chunk: string): unknown;
  text: string;
}

function createBufferWriter(): BufferWriter {
  return {
    text: "",
    write(chunk: string) {
      this.text += chunk;
    },
  };
}

describe("runStatusCommand", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sortie-cli-status-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("prints no runs when the ledger file is missing", async () => {
    const stdout = createBufferWriter();
    const stderr = createBufferWriter();

    const exitCode = await runStatusCommand({
      ledgerPath: ".sortie/ledger.yaml",
      cwd: tmpDir,
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(stdout.text).toContain("No runs found");
    expect(stderr.text).toBe("");
  });

  test("prints recent runs from the ledger", async () => {
    const fixture = loadFixture<{ runs: LedgerEntry[] }>("ledger-entries/multi-run.yaml");
    const ledgerDir = join(tmpDir, ".sortie");
    const ledgerPath = join(ledgerDir, "ledger.yaml");
    mkdirSync(ledgerDir, { recursive: true });
    writeFileSync(
      ledgerPath,
      readFileSync(
        join(import.meta.dir, "../../fixtures/ledger-entries/multi-run.yaml"),
        "utf-8",
      ),
      "utf-8",
    );

    const stdout = createBufferWriter();
    const stderr = createBufferWriter();

    const exitCode = await runStatusCommand({
      ledgerPath: ".sortie/ledger.yaml",
      cwd: tmpDir,
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(stdout.text).toContain(fixture.runs[0].run_id);
    expect(stdout.text).toContain(fixture.runs[1].run_id);
    expect(stdout.text).toContain("feature/add-parser");
    expect(stdout.text).toContain(
      "a1b2c3d4-1 feature/add-parser code fail findings=1 exit=1",
    );
    expect(stderr.text).toBe("");
  });

  test("returns the latest run exit code from the ledger", async () => {
    const fixture = loadFixture<{ runs: LedgerEntry[] }>(
      "ledger-entries/with-dispositions.yaml",
    );
    const ledgerDir = join(tmpDir, ".sortie");
    mkdirSync(ledgerDir, { recursive: true });
    writeFileSync(
      join(ledgerDir, "ledger.yaml"),
      readFileSync(
        join(
          import.meta.dir,
          "../../fixtures/ledger-entries/with-dispositions.yaml",
        ),
        "utf-8",
      ),
      "utf-8",
    );

    const stdout = createBufferWriter();
    const stderr = createBufferWriter();

    const exitCode = await runStatusCommand({
      ledgerPath: ".sortie/ledger.yaml",
      cwd: tmpDir,
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stdout.text).toContain(
      `${fixture.runs[0].run_id} feature/add-auth code pass_with_findings findings=2 exit=1`,
    );
    expect(stderr.text).toBe("");
  });

  test("returns exit 1 on corrupt ledger YAML", async () => {
    const ledgerDir = join(tmpDir, ".sortie");
    mkdirSync(ledgerDir, { recursive: true });
    writeFileSync(join(ledgerDir, "ledger.yaml"), "{{{not yaml", "utf-8");

    const stdout = createBufferWriter();
    const stderr = createBufferWriter();

    const exitCode = await runStatusCommand({
      ledgerPath: ".sortie/ledger.yaml",
      cwd: tmpDir,
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text.length).toBeGreaterThan(0);
  });
});
