import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { getTreeSha, runId as makeRunId } from "../contracts/identity.js";
import type {
  Attestation,
  Finding,
  LedgerEntry,
  ReviewerOutput,
  Verdict,
} from "../contracts/types.js";
import type { HarnessConfig, RosterEntry } from "../harness/config.js";
import { loadFixture } from "../test-support/load-fixture.js";
import type {
  EmptyDiffError as EmptyDiffErrorType,
  PipelineInput,
  PipelineResult,
  UnknownModeError as UnknownModeErrorType,
} from "./pipeline.js";

// Capture the real createDomainLock before any mock.module can replace the binding.
// bun's mock.module replaces live ESM bindings, so a later `realCreateDomainLock`
// reference would recurse infinitely if the mock delegates to itself.
const { createDomainLock: capturedCreateDomainLock } = await import("../harness/domain-lock.js");

const BRANCH = "feature/pipeline";
const MODE = "code";
const DIFF = `diff --git a/src/index.ts b/src/index.ts
index 1111111..2222222 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 export function main() {
+  return 42;
 }`;

interface MockSessionStats {
  sessionFile?: string;
  sessionId?: string;
  userMessages?: number;
  assistantMessages?: number;
  toolCalls?: number;
  toolResults?: number;
  totalMessages?: number;
  tokens?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost?: number;
}

interface SessionScript {
  responseText?: string;
  promptError?: Error;
  prompts: string[];
  disposed: boolean;
  stats?: Partial<MockSessionStats>;
}

interface Workspace {
  root: string;
  config: HarnessConfig;
  treeSha: string;
  runId: string;
  runDir: string;
}

interface PipelineHarness {
  runPipeline: (input: PipelineInput) => Promise<PipelineResult>;
  EmptyDiffError: typeof EmptyDiffErrorType;
  UnknownModeError: typeof UnknownModeErrorType;
  createReviewerSessionCalls: Array<{
    entry: RosterEntry;
    options: { cwd: string; customTools?: unknown[] };
  }>;
  createLeadSessionCalls: Array<{
    config: HarnessConfig["debrief"];
    options: { cwd: string; customTools?: unknown[] };
  }>;
  domainLockCalls: Array<{ patterns: string[]; cwd?: string }>;
}

let originalCwd = process.cwd();
let tempDirs: string[] = [];

beforeEach(() => {
  originalCwd = process.cwd();
  tempDirs = [];
  setSystemTime(new Date("2026-03-30T12:00:00.000Z"));
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  mock.restore();
  setSystemTime();
});

function rawFixture(relativePath: string): string {
  return readFileSync(join(import.meta.dir, "../../fixtures", relativePath), "utf-8");
}

function readYamlFile<T>(path: string): T {
  return parse(readFileSync(path, "utf-8")) as T;
}

function makeSessionScript(
  responseText?: string,
  overrides?: Partial<Omit<SessionScript, "prompts" | "disposed" | "responseText">>,
): SessionScript {
  return {
    responseText,
    promptError: overrides?.promptError,
    prompts: [],
    disposed: false,
    stats: overrides?.stats,
  };
}

function createMockSession(script: SessionScript): AgentSession {
  return {
    prompt: async (promptText: string) => {
      script.prompts.push(promptText);
      if (script.promptError) {
        throw script.promptError;
      }
    },
    getLastAssistantText: () => script.responseText ?? "",
    getSessionStats: () => ({
      sessionFile: undefined,
      sessionId: "sortie-pipeline-test",
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 2,
      tokens: {
        input: 1200,
        output: 300,
        cacheRead: 0,
        cacheWrite: 0,
        total: 1500,
      },
      cost: 0.01,
      ...script.stats,
    }),
    dispose: () => {
      script.disposed = true;
    },
    subscribe: () => () => {},
  } as unknown as AgentSession;
}

function withDetail(findings: Array<Partial<Finding>>): Finding[] {
  return findings.map((finding, index) => ({
    id: finding.id ?? `F${String(index + 1).padStart(3, "0")}`,
    severity: (finding.severity ?? "minor") as Finding["severity"],
    file: finding.file ?? "src/index.ts",
    line: finding.line ?? 1,
    category: finding.category ?? "correctness",
    summary: finding.summary ?? `Finding ${index + 1}`,
    detail: finding.detail ?? `${finding.summary ?? `Finding ${index + 1}`} detail`,
    convergence: finding.convergence,
    sources: finding.sources,
    disposition: finding.disposition,
  }));
}

function reviewerYaml(output: {
  model: string;
  verdict: ReviewerOutput["verdict"];
  findings: Array<Partial<Finding>>;
}): string {
  return stringify({
    model: output.model,
    verdict: output.verdict,
    findings: withDetail(output.findings),
  });
}

function verdictYaml(
  workspace: Workspace,
  partial: Pick<Verdict, "verdict" | "convergence"> & {
    findings: Array<Partial<Finding>>;
    error?: string | null;
  },
): string {
  return stringify({
    verdict: partial.verdict,
    convergence: partial.convergence,
    findings: withDetail(partial.findings),
    tree_sha: workspace.treeSha,
    cycle: 1,
    run_id: workspace.runId,
    branch: BRANCH,
    mode: MODE,
    debrief_model: workspace.config.debrief.model,
    roster: workspace.config.roster.map((entry) => entry.name),
    error: partial.error ?? null,
  });
}

function createWorkspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), "sortie-pipeline-test-"));
  tempDirs.push(root);

  mkdirSync(join(root, "prompts"), { recursive: true });
  writeFileSync(join(root, "tracked.txt"), "tracked\n", "utf-8");
  writeFileSync(
    join(root, "prompts", "reviewer.md"),
    "Review branch {branch}\nBe precise.",
    "utf-8",
  );
  writeFileSync(
    join(root, "prompts", "debrief.md"),
    "n={n}\ntree={tree_sha}\nbranch={branch}\n{sortie_outputs}",
    "utf-8",
  );

  execSync("git init -q", { cwd: root });
  execSync("git config user.email 'test@test.com'", { cwd: root });
  execSync("git config user.name 'Test'", { cwd: root });
  execSync("git add tracked.txt prompts/reviewer.md prompts/debrief.md", { cwd: root });

  const config: HarnessConfig = {
    project: "sortie-pi",
    roster: [
      {
        name: "claude",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        timeout: 60_000,
      },
      {
        name: "gemini",
        provider: "google",
        model: "gemini-2.5-pro",
        timeout: 60_000,
      },
    ],
    debrief: {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      prompt_template: "prompts/debrief.md",
    },
    triage: {
      block_on: ["critical", "major"],
    },
    modes: {
      code: {
        prompt_template: "prompts/reviewer.md",
        debrief_template: "prompts/debrief.md",
        roster: ["claude", "gemini"],
      },
    },
    deposition_dir: ".sortie",
    ledger_path: ".sortie/ledger.yaml",
  };

  const treeSha = getTreeSha(root);
  const runId = makeRunId(treeSha, 1);

  return {
    root,
    config,
    treeSha,
    runId,
    runDir: join(root, ".sortie", runId),
  };
}

async function loadPipelineHarness(args: {
  reviewerScripts: Record<string, SessionScript>;
  leadScript: SessionScript;
}): Promise<PipelineHarness> {
  const createReviewerSessionCalls: PipelineHarness["createReviewerSessionCalls"] = [];
  const createLeadSessionCalls: PipelineHarness["createLeadSessionCalls"] = [];
  const domainLockCalls: PipelineHarness["domainLockCalls"] = [];

  const createReviewerSessionMock = mock(
    async (entry: RosterEntry, options: { cwd: string; customTools?: unknown[] }) => {
      createReviewerSessionCalls.push({ entry, options });
      const script = args.reviewerScripts[entry.name];
      if (!script) {
        throw new Error(`No reviewer session configured for ${entry.name}`);
      }

      const session = createMockSession(script);
      return {
        session,
        dispose: () => session.dispose(),
      };
    },
  );

  const createLeadSessionMock = mock(
    async (
      config: HarnessConfig["debrief"],
      options: { cwd: string; customTools?: unknown[] },
    ) => {
      createLeadSessionCalls.push({ config, options });
      const session = createMockSession(args.leadScript);
      return {
        session,
        dispose: () => session.dispose(),
      };
    },
  );

  const createDomainLockMock = mock((patterns: string[], cwd?: string) => {
    domainLockCalls.push({ patterns, cwd });
    return capturedCreateDomainLock(patterns, cwd);
  });

  mock.module("../harness/session-factory.js", () => ({
    createReviewerSession: createReviewerSessionMock,
    createLeadSession: createLeadSessionMock,
  }));

  mock.module("../harness/domain-lock.js", () => ({
    createDomainLock: createDomainLockMock,
  }));

  const pipeline = await import("./pipeline.js");

  return {
    runPipeline: pipeline.runPipeline,
    EmptyDiffError: pipeline.EmptyDiffError,
    UnknownModeError: pipeline.UnknownModeError,
    createReviewerSessionCalls,
    createLeadSessionCalls,
    domainLockCalls,
  };
}

describe("runPipeline", () => {
  test.serial(
    "happy path writes reviewer artifacts, verdict, attestations, ledger, and returns merge exit code",
    async () => {
      const workspace = createWorkspace();
      process.chdir(workspace.root);

      const reviewerScripts = {
        claude: makeSessionScript(rawFixture("reviewer-outputs/pass-clean.yaml"), {
          stats: {
            tokens: {
              input: 1200,
              output: 150,
              cacheRead: 0,
              cacheWrite: 0,
              total: 1350,
            },
            cost: 0.01,
          },
        }),
        gemini: makeSessionScript(
          reviewerYaml({
            model: "gemini-2.5-pro",
            verdict: "pass",
            findings: [],
          }),
          {
            stats: {
              tokens: {
                input: 900,
                output: 100,
                cacheRead: 0,
                cacheWrite: 0,
                total: 1000,
              },
              cost: 0.008,
            },
          },
        ),
      };
      const leadScript = makeSessionScript(
        verdictYaml(workspace, {
          verdict: "pass",
          convergence: "none",
          findings: [],
        }),
        {
          stats: {
            tokens: {
              input: 2000,
              output: 250,
              cacheRead: 0,
              cacheWrite: 0,
              total: 2250,
            },
            cost: 0.02,
          },
        },
      );
      const harness = await loadPipelineHarness({ reviewerScripts, leadScript });

      const result = await harness.runPipeline({
        config: workspace.config,
        cwd: workspace.root,
        branch: BRANCH,
        mode: MODE,
        diff: DIFF,
      });

      expect(result.exit_code).toBe(0);
      expect(result.run_id).toBe(workspace.runId);
      expect(result.debrief_fallback).toBe(false);
      expect(existsSync(workspace.runDir)).toBe(true);
      expect(existsSync(join(workspace.runDir, "attestations"))).toBe(true);
      expect(existsSync(join(workspace.runDir, "sortie-claude.yaml"))).toBe(true);
      expect(existsSync(join(workspace.runDir, "sortie-gemini.yaml"))).toBe(true);
      expect(existsSync(join(workspace.runDir, "verdict.yaml"))).toBe(true);

      const reviewerArtifact = readYamlFile<ReviewerOutput>(
        join(workspace.runDir, "sortie-claude.yaml"),
      );
      expect(reviewerArtifact.model).toBe("claude-sonnet-4-20250514");
      expect(reviewerArtifact.verdict).toBe("pass");

      const verdict = readYamlFile<Verdict>(join(workspace.runDir, "verdict.yaml"));
      expect(verdict.verdict).toBe("pass");
      expect(verdict.tree_sha).toBe(workspace.treeSha);
      expect(verdict.branch).toBe(BRANCH);
      expect(verdict.mode).toBe(MODE);

      const attestationFiles = readdirSync(join(workspace.runDir, "attestations")).sort();
      expect(attestationFiles).toEqual([
        "debrief.yaml",
        "sortie-claude.yaml",
        "sortie-gemini.yaml",
      ]);

      const debriefAttestation = readYamlFile<Attestation>(
        join(workspace.runDir, "attestations", "debrief.yaml"),
      );
      expect(debriefAttestation.step).toBe("debrief");
      expect(debriefAttestation.verdict).toBe("pass");

      const ledger = readYamlFile<{ runs: LedgerEntry[] }>(
        join(workspace.root, ".sortie", "ledger.yaml"),
      );
      expect(ledger.runs).toHaveLength(1);
      expect(ledger.runs[0].run_id).toBe(workspace.runId);
      expect(result.ledger_entry.run_id).toBe(workspace.runId);

      expect(harness.createReviewerSessionCalls.map((call) => call.entry.name)).toEqual([
        "claude",
        "gemini",
      ]);
      expect(harness.createLeadSessionCalls).toHaveLength(1);

      expect(reviewerScripts.claude.prompts[0]).toContain(
        `Review branch \`${BRANCH}\``,
      );
      expect(reviewerScripts.claude.prompts[0]).toContain("```diff");
      expect(reviewerScripts.claude.prompts[0]).toContain(DIFF);

      expect(leadScript.prompts[0]).toContain("n=2");
      expect(leadScript.prompts[0]).toContain(`tree=\`${workspace.treeSha}\``);
      expect(leadScript.prompts[0]).toContain(`branch=\`${BRANCH}\``);
      expect(leadScript.prompts[0]).toContain("### claude-sonnet-4-20250514");
      expect(leadScript.prompts[0]).toContain("### gemini-2.5-pro");
      expect(result.summary.events.some((event: { type: string }) => event.type === "pipeline:complete")).toBe(
        true,
      );
    },
  );

  test.serial("throws EmptyDiffError when the diff is empty", async () => {
    const workspace = createWorkspace();
    process.chdir(workspace.root);

    const harness = await loadPipelineHarness({
      reviewerScripts: {
        claude: makeSessionScript(rawFixture("reviewer-outputs/pass-clean.yaml")),
        gemini: makeSessionScript(
          reviewerYaml({
            model: "gemini-2.5-pro",
            verdict: "pass",
            findings: [],
          }),
        ),
      },
      leadScript: makeSessionScript(
        verdictYaml(workspace, {
          verdict: "pass",
          convergence: "none",
          findings: [],
        }),
      ),
    });

    await expect(
      harness.runPipeline({
        config: workspace.config,
        cwd: workspace.root,
        branch: BRANCH,
        mode: MODE,
        diff: " \n\t",
      }),
    ).rejects.toBeInstanceOf(harness.EmptyDiffError);
  });

  test.serial("throws UnknownModeError when the requested mode is not defined", async () => {
    const workspace = createWorkspace();
    process.chdir(workspace.root);

    const harness = await loadPipelineHarness({
      reviewerScripts: {
        claude: makeSessionScript(rawFixture("reviewer-outputs/pass-clean.yaml")),
        gemini: makeSessionScript(
          reviewerYaml({
            model: "gemini-2.5-pro",
            verdict: "pass",
            findings: [],
          }),
        ),
      },
      leadScript: makeSessionScript(
        verdictYaml(workspace, {
          verdict: "pass",
          convergence: "none",
          findings: [],
        }),
      ),
    });

    await expect(
      harness.runPipeline({
        config: workspace.config,
        cwd: workspace.root,
        branch: BRANCH,
        mode: "docs",
        diff: DIFF,
      }),
    ).rejects.toBeInstanceOf(harness.UnknownModeError);
  });

  test.serial("proceeds with partial reviewer failures and persists the partial run", async () => {
    const workspace = createWorkspace();
    process.chdir(workspace.root);

    const reviewerScripts = {
      claude: makeSessionScript(undefined, {
        promptError: new Error("Timeout: reviewer exceeded time limit"),
      }),
      gemini: makeSessionScript(rawFixture("reviewer-outputs/pass-with-findings.yaml")),
    };
    const leadScript = makeSessionScript(
      verdictYaml(workspace, {
        verdict: "pass_with_findings",
        convergence: "divergent",
        findings: [
          loadFixture<{ findings: Finding[] }>("reviewer-outputs/pass-with-findings.yaml")
            .findings[0],
        ],
      }),
    );
    const harness = await loadPipelineHarness({ reviewerScripts, leadScript });

    const result = await harness.runPipeline({
      config: workspace.config,
      cwd: workspace.root,
      branch: BRANCH,
      mode: MODE,
      diff: DIFF,
    });

    expect(result.exit_code).toBe(2);
    expect(result.debrief_fallback).toBe(false);
    expect(result.reviewer_outputs).toHaveLength(2);
    expect(result.reviewer_outputs.find((output: ReviewerOutput) => output.model === "claude-sonnet-4-20250514")?.verdict).toBe(
      "error",
    );
    expect(result.reviewer_outputs.find((output: ReviewerOutput) => output.model === "gemini-2.5-pro")?.verdict).toBe(
      "pass_with_findings",
    );

    const erroredReviewer = readYamlFile<ReviewerOutput>(
      join(workspace.runDir, "sortie-claude.yaml"),
    );
    expect(erroredReviewer.verdict).toBe("error");
    expect(typeof erroredReviewer.error).toBe("string");

    const attestationFiles = readdirSync(join(workspace.runDir, "attestations")).sort();
    expect(attestationFiles).toEqual([
      "debrief.yaml",
      "sortie-claude.yaml",
      "sortie-gemini.yaml",
    ]);

    const ledger = readYamlFile<{ runs: LedgerEntry[] }>(
      join(workspace.root, ".sortie", "ledger.yaml"),
    );
    expect(ledger.runs).toHaveLength(1);
    expect(ledger.runs[0].verdict).toBe("pass_with_findings");
  });

  test.serial("fails secure when all reviewers error and returns exit code 1", async () => {
    const workspace = createWorkspace();
    process.chdir(workspace.root);

    const harness = await loadPipelineHarness({
      reviewerScripts: {
        claude: makeSessionScript(undefined, {
          promptError: new Error("Timeout: reviewer exceeded time limit"),
        }),
        gemini: makeSessionScript(undefined, {
          promptError: new Error("Network error from reviewer"),
        }),
      },
      leadScript: makeSessionScript(undefined, {
        promptError: new Error("Lead should not be able to recover all-error runs"),
      }),
    });

    const result = await harness.runPipeline({
      config: workspace.config,
      cwd: workspace.root,
      branch: BRANCH,
      mode: MODE,
      diff: DIFF,
    });

    expect(result.exit_code).toBe(1);
    expect(result.debrief_fallback).toBe(true);
    expect(result.verdict.verdict).toBe("error");
    expect(result.verdict.error).toContain("fail-secure");
    expect(result.triage.action).toBe("block");
    expect(result.triage.exit_code).toBe(1);
    expect(result.reviewer_outputs.every((output: ReviewerOutput) => output.verdict === "error")).toBe(
      true,
    );

    const verdict = readYamlFile<Verdict>(join(workspace.runDir, "verdict.yaml"));
    expect(verdict.verdict).toBe("error");
    expect(verdict.error).toContain("fail-secure");

    const ledger = readYamlFile<{ runs: LedgerEntry[] }>(
      join(workspace.root, ".sortie", "ledger.yaml"),
    );
    expect(ledger.runs).toHaveLength(1);
    expect(ledger.runs[0].verdict).toBe("error");
  });

  test.serial("falls back deterministically when the debrief model errors", async () => {
    const workspace = createWorkspace();
    process.chdir(workspace.root);

    const fallbackFixture = loadFixture<{
      reviewers: ReviewerOutput[];
      debrief_error: string;
      expected_verdict: Verdict["verdict"];
      expected_convergence: Verdict["convergence"];
      expected_findings_count: number;
    }>("failure-scenarios/debrief-fallback.yaml");

    const harness = await loadPipelineHarness({
      reviewerScripts: {
        claude: makeSessionScript(reviewerYaml({
          model: fallbackFixture.reviewers[0].model,
          verdict: fallbackFixture.reviewers[0].verdict,
          findings: fallbackFixture.reviewers[0].findings,
        })),
        gemini: makeSessionScript(reviewerYaml({
          model: fallbackFixture.reviewers[1].model,
          verdict: fallbackFixture.reviewers[1].verdict,
          findings: fallbackFixture.reviewers[1].findings,
        })),
      },
      leadScript: makeSessionScript(undefined, {
        promptError: new Error(fallbackFixture.debrief_error),
      }),
    });

    const result = await harness.runPipeline({
      config: workspace.config,
      cwd: workspace.root,
      branch: BRANCH,
      mode: MODE,
      diff: DIFF,
    });

    expect(result.debrief_fallback).toBe(true);
    expect(result.exit_code).toBe(2);
    expect(result.verdict.verdict).toBe(fallbackFixture.expected_verdict);
    expect(result.verdict.convergence).toBe(fallbackFixture.expected_convergence);
    expect(result.verdict.findings).toHaveLength(fallbackFixture.expected_findings_count);
    expect(result.verdict.findings.every((finding: Finding) => finding.convergence === "divergent")).toBe(
      true,
    );
  });

  test.serial("blocks when debrief returns a convergent critical finding", async () => {
    const workspace = createWorkspace();
    process.chdir(workspace.root);

    const triageFixture = loadFixture<{
      input_verdict: {
        verdict: Verdict["verdict"];
        convergence: Verdict["convergence"];
        findings: Finding[];
      };
      expected: {
        exit_code: 0 | 1 | 2;
        blocking_findings_count: number;
      };
    }>("triage-outcomes/block-convergent-critical.yaml");

    const harness = await loadPipelineHarness({
      reviewerScripts: {
        claude: makeSessionScript(rawFixture("reviewer-outputs/fail-critical.yaml")),
        gemini: makeSessionScript(rawFixture("reviewer-outputs/fail-critical.yaml")),
      },
      leadScript: makeSessionScript(
        verdictYaml(workspace, {
          verdict: triageFixture.input_verdict.verdict,
          convergence: triageFixture.input_verdict.convergence,
          findings: triageFixture.input_verdict.findings,
        }),
      ),
    });

    const result = await harness.runPipeline({
      config: workspace.config,
      cwd: workspace.root,
      branch: BRANCH,
      mode: MODE,
      diff: DIFF,
    });

    expect(result.exit_code).toBe(triageFixture.expected.exit_code);
    expect(result.debrief_fallback).toBe(false);
    expect(result.triage.action).toBe("block");
    expect(result.triage.blocking_findings).toHaveLength(
      triageFixture.expected.blocking_findings_count,
    );
    expect(result.verdict.verdict).toBe("fail");
  });

  test.serial("returns exit code 2 when findings are advisory only", async () => {
    const workspace = createWorkspace();
    process.chdir(workspace.root);

    const triageFixture = loadFixture<{
      input_verdict: {
        verdict: Verdict["verdict"];
        convergence: Verdict["convergence"];
        findings: Finding[];
      };
      expected: {
        exit_code: 0 | 1 | 2;
        advisory_findings_count: number;
      };
    }>("triage-outcomes/no-block-divergent-critical.yaml");

    const harness = await loadPipelineHarness({
      reviewerScripts: {
        claude: makeSessionScript(rawFixture("reviewer-outputs/fail-critical.yaml")),
        gemini: makeSessionScript(rawFixture("reviewer-outputs/pass-clean.yaml")),
      },
      leadScript: makeSessionScript(
        verdictYaml(workspace, {
          verdict: triageFixture.input_verdict.verdict,
          convergence: triageFixture.input_verdict.convergence,
          findings: triageFixture.input_verdict.findings,
        }),
      ),
    });

    const result = await harness.runPipeline({
      config: workspace.config,
      cwd: workspace.root,
      branch: BRANCH,
      mode: MODE,
      diff: DIFF,
    });

    expect(result.exit_code).toBe(triageFixture.expected.exit_code);
    expect(result.triage.action).toBe("merge_with_findings");
    expect(result.triage.blocking_findings).toEqual([]);
    expect(result.triage.advisory_findings).toHaveLength(
      triageFixture.expected.advisory_findings_count,
    );
  });

  test.serial("creates a run-scoped domain lock before creating the lead session", async () => {
    const workspace = createWorkspace();
    process.chdir(workspace.root);

    const reviewerScripts = {
      claude: makeSessionScript(rawFixture("reviewer-outputs/pass-clean.yaml")),
      gemini: makeSessionScript(
        reviewerYaml({
          model: "gemini-2.5-pro",
          verdict: "pass",
          findings: [],
        }),
      ),
    };
    const leadScript = makeSessionScript(
      verdictYaml(workspace, {
        verdict: "pass",
        convergence: "none",
        findings: [],
      }),
    );
    const harness = await loadPipelineHarness({ reviewerScripts, leadScript });

    await harness.runPipeline({
      config: workspace.config,
      cwd: workspace.root,
      branch: BRANCH,
      mode: MODE,
      diff: DIFF,
    });

    expect(harness.domainLockCalls).toEqual([
      {
        patterns: [`.sortie/${workspace.runId}/**`],
        cwd: workspace.root,
      },
    ]);
    expect(harness.createLeadSessionCalls).toHaveLength(1);
    expect(harness.createLeadSessionCalls[0].options.customTools).toBeDefined();
    expect(harness.createLeadSessionCalls[0].options.customTools!.length).toBeGreaterThan(0);
  });
});
