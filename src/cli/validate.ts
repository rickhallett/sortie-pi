import { resolve } from "node:path";
import { loadHarnessConfig } from "../harness/config.js";
import { EmptyDiffError, runPipeline } from "../validation/pipeline.js";
import type { PipelineResult, PipelineInput } from "../validation/pipeline.js";

const INFRASTRUCTURE_FAILURE_EXIT_CODE = 3;

export interface WriterLike {
  write(chunk: string): unknown;
}

export interface ValidateCommandOptions {
  configPath: string;
  branch: string;
  mode?: string;
  cwd?: string;
  stdout?: WriterLike;
  stderr?: WriterLike;
}

export interface ValidateCommandDeps {
  loadConfig: typeof loadHarnessConfig;
  runValidation: (input: PipelineInput) => Promise<PipelineResult>;
  EmptyDiffErrorCtor: new (...args: any[]) => Error;
}

const defaultDeps: ValidateCommandDeps = {
  loadConfig: loadHarnessConfig,
  runValidation: runPipeline,
  EmptyDiffErrorCtor: EmptyDiffError,
};

function writeLine(writer: WriterLike, message: string): void {
  writer.write(`${message}\n`);
}

export async function runValidateCommand(
  options: ValidateCommandOptions,
  deps: ValidateCommandDeps = defaultDeps,
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const mode = options.mode ?? "code";

  try {
    const config = deps.loadConfig(resolve(cwd, options.configPath));
    const result = await deps.runValidation({
      config,
      cwd,
      branch: options.branch,
      mode,
    });

    writeLine(
      stdout,
      `Run ${result.run_id}: ${result.triage.action} (exit ${result.exit_code})`,
    );
    writeLine(
      stdout,
      `Verdict ${result.verdict.verdict}; findings=${result.verdict.findings.length}; fallback=${result.debrief_fallback}`,
    );

    return result.exit_code;
  } catch (error) {
    if (error instanceof deps.EmptyDiffErrorCtor) {
      writeLine(stdout, error.message);
      return 0;
    }

    writeLine(
      stderr,
      error instanceof Error ? error.message : String(error),
    );
    return INFRASTRUCTURE_FAILURE_EXIT_CODE;
  }
}
