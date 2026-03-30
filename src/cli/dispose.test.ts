import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { loadFixture } from "../test-support/load-fixture.js";
import type { LedgerEntry, Verdict } from "../contracts/types.js";
import { runDisposeBulkCommand, runDisposeCommand } from "./dispose.js";

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

describe("dispose commands", () => {
  let tmpDir: string;
  let runId: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sortie-cli-dispose-test-"));
    const ledgerFixture = loadFixture<{ runs: LedgerEntry[] }>("ledger-entries/multi-run.yaml");
    const verdictFixture = loadFixture<Verdict>("verdicts/fail.yaml");
    const sortieDir = join(tmpDir, ".sortie");
    runId = ledgerFixture.runs[0].run_id;
    ledgerPath = join(sortieDir, "ledger.yaml");

    mkdirSync(join(sortieDir, runId), { recursive: true });
    writeFileSync(
      ledgerPath,
      stringify(ledgerFixture),
      "utf-8",
    );

    // Align the verdict run id with the ledger fixture.
    verdictFixture.run_id = runId;
    verdictFixture.tree_sha = ledgerFixture.runs[0].tree_sha;
    writeFileSync(
      join(sortieDir, runId, "verdict.yaml"),
      stringify(verdictFixture),
      "utf-8",
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("dispose updates both ledger and verdict", async () => {
    const stdout = createBufferWriter();
    const stderr = createBufferWriter();

    const exitCode = await runDisposeCommand({
      ledgerPath: ".sortie/ledger.yaml",
      runId,
      findingId: "CF001",
      disposition: "fixed",
      cwd: tmpDir,
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(stdout.text).toContain("CF001 -> fixed");

    const verdict = parse(
      readFileSync(join(tmpDir, ".sortie", runId, "verdict.yaml"), "utf-8"),
    ) as Verdict;
    expect(verdict.findings[0].disposition).toBe("fixed");
  });

  test("dispose-bulk updates all verdict findings and ledger summary", async () => {
    const passWithFindings = loadFixture<Verdict>("verdicts/pass-with-findings.yaml");
    const ledgerFixture = loadFixture<{ runs: LedgerEntry[] }>(
      "ledger-entries/with-dispositions.yaml",
    );
    const sortieDir = join(tmpDir, ".sortie");
    runId = ledgerFixture.runs[0].run_id;
    writeFileSync(ledgerPath, stringify(ledgerFixture), "utf-8");
    mkdirSync(join(sortieDir, runId), { recursive: true });
    passWithFindings.run_id = runId;
    passWithFindings.tree_sha = ledgerFixture.runs[0].tree_sha;
    passWithFindings.branch = ledgerFixture.runs[0].branch;
    writeFileSync(
      join(sortieDir, runId, "verdict.yaml"),
      stringify(passWithFindings),
      "utf-8",
    );

    const stdout = createBufferWriter();
    const stderr = createBufferWriter();

    const exitCode = await runDisposeBulkCommand({
      ledgerPath: ".sortie/ledger.yaml",
      runId,
      disposition: "deferred",
      cwd: tmpDir,
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(stdout.text).toContain(`${runId} -> deferred`);
    const verdict = parse(
      readFileSync(join(tmpDir, ".sortie", runId, "verdict.yaml"), "utf-8"),
    ) as Verdict;
    expect(verdict.findings.every((finding) => finding.disposition === "deferred")).toBe(
      true,
    );
    const updatedLedger = parse(readFileSync(ledgerPath, "utf-8")) as {
      runs: LedgerEntry[];
    };
    expect(updatedLedger.runs[0].dispositions.deferred).toBe(2);
  });

  test("dispose-bulk preserves additional finding fields when rewriting verdict", async () => {
    const sortieDir = join(tmpDir, ".sortie");
    const ledgerFixture = loadFixture<{ runs: LedgerEntry[] }>(
      "ledger-entries/with-dispositions.yaml",
    );
    runId = ledgerFixture.runs[0].run_id;
    writeFileSync(ledgerPath, stringify(ledgerFixture), "utf-8");
    const verdictDoc = parse(
      stringify(loadFixture<Verdict>("verdicts/pass-with-findings.yaml")),
    ) as Record<string, any>;
    verdictDoc.run_id = runId;
    verdictDoc.tree_sha = ledgerFixture.runs[0].tree_sha;
    verdictDoc.branch = ledgerFixture.runs[0].branch;
    verdictDoc.findings[0].extra_context = "keep-me";
    mkdirSync(join(sortieDir, runId), { recursive: true });
    writeFileSync(
      join(sortieDir, runId, "verdict.yaml"),
      stringify(verdictDoc),
      "utf-8",
    );

    const stdout = createBufferWriter();
    const stderr = createBufferWriter();

    const exitCode = await runDisposeBulkCommand({
      ledgerPath: ".sortie/ledger.yaml",
      runId,
      disposition: "deferred",
      cwd: tmpDir,
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    const rewritten = parse(
      readFileSync(join(sortieDir, runId, "verdict.yaml"), "utf-8"),
    ) as Record<string, any>;
    expect(rewritten.findings[0].disposition).toBe("deferred");
    expect(rewritten.findings[0].extra_context).toBe("keep-me");
  });

  test("rejects ledger entries whose run id escapes the deposition directory", async () => {
    const maliciousRunId = "../../escape";
    const ledgerFixture = loadFixture<{ runs: LedgerEntry[] }>(
      "ledger-entries/single-run.yaml",
    );
    ledgerFixture.runs[0].run_id = maliciousRunId;
    writeFileSync(ledgerPath, stringify(ledgerFixture), "utf-8");

    const stdout = createBufferWriter();
    const stderr = createBufferWriter();

    const exitCode = await runDisposeBulkCommand({
      ledgerPath: ".sortie/ledger.yaml",
      runId: maliciousRunId,
      disposition: "fixed",
      cwd: tmpDir,
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain(`Invalid run ID: ${maliciousRunId}`);
  });

  test("returns exit 1 when the run id does not exist", async () => {
    const stdout = createBufferWriter();
    const stderr = createBufferWriter();

    const exitCode = await runDisposeCommand({
      ledgerPath: ".sortie/ledger.yaml",
      runId: "missing-1",
      findingId: "CF001",
      disposition: "fixed",
      cwd: tmpDir,
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain("Run not found");
  });
});
