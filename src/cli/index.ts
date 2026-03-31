import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runDisposeBulkCommand, runDisposeCommand } from "./dispose.js";
import { runOrchestrateCommand } from "./orchestrate.js";
import { runStatusCommand } from "./status.js";
import { runValidateCommand, type WriterLike } from "./validate.js";

interface CliIO {
  stdout?: WriterLike;
  stderr?: WriterLike;
  cwd?: string;
}

export interface CliHandlers {
  validate: typeof runValidateCommand;
  status: typeof runStatusCommand;
  dispose: typeof runDisposeCommand;
  disposeBulk: typeof runDisposeBulkCommand;
}

type ParsedFlags = Record<string, string>;

function writeLine(writer: WriterLike, message: string): void {
  writer.write(`${message}\n`);
}

function usage(): string {
  return [
    "Usage:",
    "  orchestrate --config <path>",
    "  validate --config <path> --branch <branch> [--mode <mode>]",
    "  status --ledger <path>",
    "  dispose --ledger <path> --run-id <id> --finding <id> --disposition <value>",
    "  dispose-bulk --ledger <path> --run-id <id> --disposition <value>",
  ].join("\n");
}

function parseFlags(args: string[]): ParsedFlags {
  const flags: ParsedFlags = {};

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const value = args[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    flags[key] = value;
    i++;
  }

  return flags;
}

const defaultHandlers: CliHandlers = {
  validate: runValidateCommand,
  status: runStatusCommand,
  dispose: runDisposeCommand,
  disposeBulk: runDisposeBulkCommand,
};

export async function main(
  argv = process.argv.slice(2),
  io: CliIO = {},
  handlers: CliHandlers = defaultHandlers,
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const cwd = io.cwd ?? process.cwd();

  try {
    const [command, ...rest] = argv;
    if (!command || command === "--help" || command === "-h") {
      writeLine(stdout, usage());
      return command ? 0 : 1;
    }

    const flags = parseFlags(rest);

    switch (command) {
      case "orchestrate":
        if (!flags.config) throw new Error("Missing required flag: --config");
        return runOrchestrateCommand({
          configPath: flags.config,
          cwd,
          stdout,
          stderr,
        });

      case "validate":
        if (!flags.config) throw new Error("Missing required flag: --config");
        if (!flags.branch) throw new Error("Missing required flag: --branch");
        return handlers.validate({
          configPath: flags.config,
          branch: flags.branch,
          mode: flags.mode ?? "code",
          cwd,
          stdout,
          stderr,
        });

      case "status":
        if (!flags.ledger) throw new Error("Missing required flag: --ledger");
        return handlers.status({
          ledgerPath: flags.ledger,
          cwd,
          stdout,
          stderr,
        });

      case "dispose":
        if (!flags.ledger) throw new Error("Missing required flag: --ledger");
        if (!flags["run-id"]) throw new Error("Missing required flag: --run-id");
        if (!flags.finding) throw new Error("Missing required flag: --finding");
        if (!flags.disposition) throw new Error("Missing required flag: --disposition");
        return handlers.dispose({
          ledgerPath: flags.ledger,
          runId: flags["run-id"],
          findingId: flags.finding,
          disposition: flags.disposition,
          cwd,
          stdout,
          stderr,
        });

      case "dispose-bulk":
        if (!flags.ledger) throw new Error("Missing required flag: --ledger");
        if (!flags["run-id"]) throw new Error("Missing required flag: --run-id");
        if (!flags.disposition) throw new Error("Missing required flag: --disposition");
        return handlers.disposeBulk({
          ledgerPath: flags.ledger,
          runId: flags["run-id"],
          disposition: flags.disposition,
          cwd,
          stdout,
          stderr,
        });

      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    writeLine(
      stderr,
      error instanceof Error ? error.message : String(error),
    );
    writeLine(stderr, usage());
    return 1;
  }
}

const isMain =
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
