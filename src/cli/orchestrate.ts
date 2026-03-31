import { createInterface } from "node:readline";
import { startOrchestrator } from "../orchestrator/index.js";
import type { WriterLike } from "./validate.js";

export interface OrchestrateCommandOptions {
  configPath: string;
  cwd?: string;
  stdout?: WriterLike;
  stderr?: WriterLike;
}

function writeLine(writer: WriterLike, message: string): void {
  writer.write(`${message}\n`);
}

export async function runOrchestrateCommand(
  options: OrchestrateCommandOptions,
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    writeLine(stdout, "Starting orchestrator...");
    const { session, dispose } = await startOrchestrator(options.configPath, cwd);
    writeLine(stdout, "Orchestrator ready. Type your request (Ctrl+D to exit).\n");

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "You: ",
    });

    rl.prompt();

    for await (const line of rl) {
      const input = line.trim();
      if (!input) {
        rl.prompt();
        continue;
      }

      try {
        await session.prompt(input);
        const response = session.getLastAssistantText();
        if (response) {
          writeLine(stdout, `\nOrchestrator: ${response}\n`);
        }
      } catch (err) {
        writeLine(
          stderr,
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      rl.prompt();
    }

    dispose();
    writeLine(stdout, "\nSession ended.");
    return 0;
  } catch (error) {
    writeLine(
      stderr,
      error instanceof Error ? error.message : String(error),
    );
    return 1;
  }
}
