import { basename, dirname, relative, resolve } from "node:path";
import { Ledger } from "../contracts/ledger.js";
import type { Disposition, LedgerEntry } from "../contracts/types.js";
import {
  readVerdict,
  updateFindingDisposition,
  writeVerdict,
} from "../contracts/verdict.js";
import type { WriterLike } from "./validate.js";

const VALID_DISPOSITIONS = new Set<Disposition>([
  "fixed",
  "false-positive",
  "deferred",
  "disagree",
]);

export interface DisposeCommandOptions {
  ledgerPath: string;
  runId: string;
  disposition: string;
  findingId?: string;
  cwd?: string;
  stdout?: WriterLike;
  stderr?: WriterLike;
}

function writeLine(writer: WriterLike, message: string): void {
  writer.write(`${message}\n`);
}

function requireDisposition(value: string): Disposition {
  if (!VALID_DISPOSITIONS.has(value as Disposition)) {
    throw new Error(
      `Invalid disposition: ${value} (expected fixed, false-positive, deferred, or disagree)`,
    );
  }
  return value as Disposition;
}

function resolveRun(ledger: Ledger, runId: string): LedgerEntry {
  const run = ledger.load().runs.find((entry) => entry.run_id === runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  return run;
}

function resolveRunDir(ledgerPath: string, runId: string): string {
  if (runId !== basename(runId) || runId === "." || runId === "..") {
    throw new Error(`Invalid run ID: ${runId}`);
  }

  const depositionDir = resolve(dirname(ledgerPath));
  const runDir = resolve(depositionDir, runId);
  const relativeRunDir = relative(depositionDir, runDir);
  if (
    relativeRunDir === "" ||
    relativeRunDir.startsWith("..") ||
    relativeRunDir.includes("/")
  ) {
    throw new Error(`Invalid run ID: ${runId}`);
  }

  return runDir;
}

export async function runDisposeCommand(
  options: DisposeCommandOptions,
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    if (!options.findingId) {
      throw new Error("findingId is required");
    }

    const disposition = requireDisposition(options.disposition);
    const ledgerPath = resolve(cwd, options.ledgerPath);
    const ledger = new Ledger(ledgerPath);
    const run = resolveRun(ledger, options.runId);
    const runDir = resolveRunDir(ledgerPath, run.run_id);

    const verdict = readVerdict(runDir);
    if (!verdict) {
      throw new Error(`No verdict.yaml found at ${runDir}`);
    }
    if (!verdict.findings.some((finding) => finding.id === options.findingId)) {
      throw new Error(
        `Finding with id "${options.findingId}" not found in verdict at ${runDir}`,
      );
    }

    updateFindingDisposition(runDir, options.findingId, disposition);
    ledger.updateDispositionByRunId(run.run_id, options.findingId, disposition);

    writeLine(
      stdout,
      `Updated ${options.runId} ${options.findingId} -> ${disposition}`,
    );
    return 0;
  } catch (error) {
    writeLine(
      stderr,
      error instanceof Error ? error.message : String(error),
    );
    return 1;
  }
}

export async function runDisposeBulkCommand(
  options: DisposeCommandOptions,
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    const disposition = requireDisposition(options.disposition);
    const ledgerPath = resolve(cwd, options.ledgerPath);
    const ledger = new Ledger(ledgerPath);
    const run = resolveRun(ledger, options.runId);
    const runDir = resolveRunDir(ledgerPath, run.run_id);

    const verdict = readVerdict(runDir);
    if (!verdict) {
      throw new Error(`No verdict.yaml found at ${runDir}`);
    }

    for (const finding of verdict.findings) {
      finding.disposition = disposition;
    }
    writeVerdict(runDir, verdict);
    ledger.bulkDisposeByRunId(run.run_id, disposition);

    writeLine(stdout, `Updated ${options.runId} -> ${disposition}`);
    return 0;
  } catch (error) {
    writeLine(
      stderr,
      error instanceof Error ? error.message : String(error),
    );
    return 1;
  }
}
