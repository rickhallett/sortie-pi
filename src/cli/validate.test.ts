import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessConfig } from "../harness/config.js";
import { loadHarnessConfig } from "../harness/config.js";
import type { PipelineInput, PipelineResult } from "../validation/pipeline.js";

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

function writeHarnessConfig(root: string): void {
  mkdirSync(join(root, "prompts"), { recursive: true });
  writeFileSync(join(root, "prompts", "sortie-code.md"), "review {branch}", "utf-8");
  writeFileSync(join(root, "prompts", "debrief.md"), "debrief", "utf-8");
  writeFileSync(
    join(root, "harness.yaml"),
    `project: sortie-pi
roster:
  - name: claude
    provider: anthropic
    model: claude-sonnet-4-20250514
debrief:
  model: claude-sonnet-4-20250514
  provider: anthropic
  prompt_template: prompts/debrief.md
triage:
  block_on: ["critical", "major"]
modes:
  code:
    prompt_template: prompts/sortie-code.md
deposition_dir: .sortie
ledger_path: .sortie/ledger.yaml
`,
    "utf-8",
  );
}

describe("runValidateCommand", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sortie-cli-validate-test-"));
    writeHarnessConfig(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test.serial("loads config, calls runPipeline, and returns its exit code", async () => {
    const calls: unknown[] = [];
    class TestEmptyDiffError extends Error {}

    const { runValidateCommand } = await import("./validate.js");
    const stdout = createBufferWriter();
    const stderr = createBufferWriter();

    const exitCode = await runValidateCommand(
      {
        configPath: "harness.yaml",
        branch: "feature/x",
        cwd: tmpDir,
        stdout,
        stderr,
      },
      {
        loadConfig: loadHarnessConfig,
        runValidation: async (input: PipelineInput): Promise<PipelineResult> => {
          calls.push(input);
          return {
            exit_code: 2,
            run_id: "a1b2c3d4-1",
            run_dir: ".sortie/a1b2c3d4-1",
            verdict: {
              verdict: "pass_with_findings",
              convergence: "divergent",
              findings: [],
              tree_sha: "a".repeat(40),
              cycle: 1,
              run_id: "a1b2c3d4-1",
              branch: "feature/x",
              mode: "code",
              error: null,
            },
            triage: {
              action: "merge_with_findings",
              exit_code: 2,
              blocking_findings: [],
              advisory_findings: [],
              all_clear_warning: null,
            },
            reviewer_outputs: [],
            debrief_fallback: false,
            ledger_entry: {
              run_id: "a1b2c3d4-1",
              tree_sha: "a".repeat(40),
              cycle: 1,
              timestamp: "2026-03-30T12:00:00Z",
              project: "sortie-pi",
              branch: "feature/x",
              worker_branch: "feature/x",
              mode: "code",
              verdict: "pass_with_findings",
              convergence: "divergent",
              triage_action: "merge_with_findings",
              exit_code: 2,
              debrief_model: "claude-sonnet-4-20250514",
              roster_used: ["claude"],
              model_status: {},
              findings: [],
              diff_stats: {},
              wall_time_ms: 0,
              tokens: { by_model: {}, total: 0 },
              findings_total: 0,
              findings_convergent: 0,
              findings_divergent: 0,
              by_severity: { critical: 0, major: 0, minor: 0 },
              dispositions: {
                fixed: 0,
                "false-positive": 0,
                deferred: 0,
                disagree: 0,
              },
            },
            summary: {
              total_tokens: 0,
              total_cost: 0,
              total_wall_time_ms: 0,
              by_step: {},
              events: [],
            },
          };
        },
        EmptyDiffErrorCtor: TestEmptyDiffError,
      },
    );

    expect(exitCode).toBe(2);
    expect(calls).toHaveLength(1);
    const input = calls[0] as {
      config: HarnessConfig;
      cwd: string;
      branch: string;
      mode: string;
    };
    expect(input.cwd).toBe(tmpDir);
    expect(input.branch).toBe("feature/x");
    expect(input.mode).toBe("code");
    expect(input.config.project).toBe("sortie-pi");
    expect(stdout.text).toContain("Run a1b2c3d4-1");
    expect(stderr.text).toBe("");
  });

  test.serial("maps EmptyDiffError to exit 0", async () => {
    class TestEmptyDiffError extends Error {
      constructor() {
        super("Diff is empty — nothing to review");
      }
    }

    const { runValidateCommand } = await import("./validate.js");
    const stdout = createBufferWriter();
    const stderr = createBufferWriter();

    const exitCode = await runValidateCommand(
      {
        configPath: "harness.yaml",
        branch: "feature/x",
        cwd: tmpDir,
        stdout,
        stderr,
      },
      {
        loadConfig: loadHarnessConfig,
        runValidation: async () => {
          throw new TestEmptyDiffError();
        },
        EmptyDiffErrorCtor: TestEmptyDiffError,
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout.text).toContain("Diff is empty");
    expect(stderr.text).toBe("");
  });

  test.serial("returns exit 3 when runPipeline throws a regular error", async () => {
    class TestEmptyDiffError extends Error {}

    const { runValidateCommand } = await import("./validate.js");
    const stdout = createBufferWriter();
    const stderr = createBufferWriter();

    const exitCode = await runValidateCommand(
      {
        configPath: "harness.yaml",
        branch: "feature/x",
        mode: "docs",
        cwd: tmpDir,
        stdout,
        stderr,
      },
      {
        loadConfig: loadHarnessConfig,
        runValidation: async () => {
          throw new Error('Unknown review mode: "docs"');
        },
        EmptyDiffErrorCtor: TestEmptyDiffError,
      },
    );

    expect(exitCode).toBe(3);
    expect(stderr.text).toContain('Unknown review mode: "docs"');
  });
});
