import { describe, expect, test } from "bun:test";
import { main, type CliHandlers } from "./index.js";

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

describe("cli main", () => {
  test.serial("dispatches validate with default mode code", async () => {
    const calls: unknown[] = [];
    const handlers: CliHandlers = {
      validate: async (options) => {
        calls.push(options);
        return 0;
      },
      status: async () => 0,
      dispose: async () => 0,
      disposeBulk: async () => 0,
    };
    const stdout = createBufferWriter();
    const stderr = createBufferWriter();

    const exitCode = await main(
      ["validate", "--config", "harness.yaml", "--branch", "feature/x"],
      { stdout, stderr, cwd: "/workspace/project" },
      handlers,
    );

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      {
        configPath: "harness.yaml",
        branch: "feature/x",
        mode: "code",
        cwd: "/workspace/project",
        stdout,
        stderr,
      },
    ]);
  });

  test.serial("dispatches dispose-bulk", async () => {
    const bulkCalls: unknown[] = [];
    const handlers: CliHandlers = {
      validate: async () => 0,
      status: async () => 0,
      dispose: async () => 0,
      disposeBulk: async (options) => {
        bulkCalls.push(options);
        return 0;
      },
    };
    const stdout = createBufferWriter();
    const stderr = createBufferWriter();

    const exitCode = await main(
      [
        "dispose-bulk",
        "--ledger",
        ".sortie/ledger.yaml",
        "--run-id",
        "a1b2c3d4-1",
        "--disposition",
        "fixed",
      ],
      { stdout, stderr, cwd: "/workspace/project" },
      handlers,
    );

    expect(exitCode).toBe(0);
    expect(bulkCalls).toEqual([
      {
        ledgerPath: ".sortie/ledger.yaml",
        runId: "a1b2c3d4-1",
        disposition: "fixed",
        cwd: "/workspace/project",
        stdout,
        stderr,
      },
    ]);
  });

  test.serial("returns exit 1 on unknown commands", async () => {
    const handlers: CliHandlers = {
      validate: async () => 0,
      status: async () => 0,
      dispose: async () => 0,
      disposeBulk: async () => 0,
    };
    const stdout = createBufferWriter();
    const stderr = createBufferWriter();

    const exitCode = await main(["unknown"], { stdout, stderr }, handlers);

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain("Unknown command: unknown");
    expect(stderr.text).toContain("Usage:");
  });

  test.serial("returns exit 1 when required flags are missing", async () => {
    const handlers: CliHandlers = {
      validate: async () => 0,
      status: async () => 0,
      dispose: async () => 0,
      disposeBulk: async () => 0,
    };
    const stdout = createBufferWriter();
    const stderr = createBufferWriter();

    const exitCode = await main(
      ["dispose", "--ledger", ".sortie/ledger.yaml", "--run-id", "a1b2c3d4-1"],
      { stdout, stderr },
      handlers,
    );

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain("Missing required flag: --finding");
  });
});
