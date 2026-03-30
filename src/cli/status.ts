import { resolve } from "node:path";
import { Ledger } from "../contracts/ledger.js";
import type { LedgerEntry } from "../contracts/types.js";
import type { WriterLike } from "./validate.js";

export interface StatusCommandOptions {
  ledgerPath: string;
  cwd?: string;
  stdout?: WriterLike;
  stderr?: WriterLike;
}

function writeLine(writer: WriterLike, message: string): void {
  writer.write(`${message}\n`);
}

function deriveLegacyExitCode(run: LedgerEntry): 0 | 1 | 2 {
  if (run.verdict === "error") {
    return 1;
  }
  if (run.findings_total > 0) {
    return 2;
  }
  return 0;
}

function getRunExitCode(run: LedgerEntry): 0 | 1 | 2 {
  return run.exit_code ?? deriveLegacyExitCode(run);
}

function formatRun(run: LedgerEntry): string {
  const exitCode = getRunExitCode(run);
  return `${run.run_id} ${run.branch} ${run.mode} ${run.verdict} findings=${run.findings_total} exit=${exitCode}`;
}

export async function runStatusCommand(
  options: StatusCommandOptions,
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    const ledger = new Ledger(resolve(cwd, options.ledgerPath));
    const runs = ledger
      .load()
      .runs
      .slice()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (runs.length === 0) {
      writeLine(stdout, "No runs found");
      return 0;
    }

    for (const run of runs) {
      writeLine(stdout, formatRun(run));
    }

    return getRunExitCode(runs[0]);
  } catch (error) {
    writeLine(
      stderr,
      error instanceof Error ? error.message : String(error),
    );
    return 1;
  }
}
