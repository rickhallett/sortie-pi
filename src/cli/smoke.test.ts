import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixture } from "../test-support/load-fixture.js";
import type { LedgerEntry, Verdict } from "../contracts/types.js";
import { stringify } from "yaml";

const REPO_ROOT = join(import.meta.dir, "../..");
const DIST_CLI = join(REPO_ROOT, "dist/cli/index.js");

function writeHarnessConfig(root: string): void {
  mkdirSync(join(root, "prompts"), { recursive: true });
  writeFileSync(
    join(root, "prompts", "sortie-code.md"),
    "review branch {branch}",
    "utf-8",
  );
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

function initGitRepoWithOriginMain(root: string, branch: string): void {
  execFileSync("git", ["init", "--initial-branch=main"], {
    cwd: root,
    encoding: "utf-8",
  });
  execFileSync("git", ["config", "user.name", "Sortie Tests"], {
    cwd: root,
    encoding: "utf-8",
  });
  execFileSync("git", ["config", "user.email", "sortie-tests@example.com"], {
    cwd: root,
    encoding: "utf-8",
  });
  writeFileSync(join(root, "README.md"), "# smoke\n", "utf-8");
  execFileSync("git", ["add", "README.md"], { cwd: root, encoding: "utf-8" });
  execFileSync("git", ["commit", "-m", "initial"], {
    cwd: root,
    encoding: "utf-8",
  });
  execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], {
    cwd: root,
    encoding: "utf-8",
  });
  execFileSync("git", ["checkout", "-b", branch], {
    cwd: root,
    encoding: "utf-8",
  });
}

// Smoke tests call `bun run build` which writes to dist/, triggering the
// file watcher and causing an infinite restart loop in `bun test --watch`.
// Use `bun run test:watch` (sets SKIP_SMOKE=1) for the development loop.
describe.skipIf(!!process.env.SKIP_SMOKE)("cli smoke", () => {
  let tmpDir = "";

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  test("build emits dist/cli/index.js and built status command runs under node", () => {
    execSync("bun run build", { cwd: REPO_ROOT, stdio: "pipe" });
    expect(existsSync(join(REPO_ROOT, "dist/cli/index.js"))).toBe(true);

    tmpDir = mkdtempSync(join(tmpdir(), "sortie-cli-smoke-"));
    mkdirSync(join(tmpDir, ".sortie"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".sortie", "ledger.yaml"),
      readFileSync(join(REPO_ROOT, "fixtures/ledger-entries/multi-run.yaml"), "utf-8"),
      "utf-8",
    );

    const stdout = execFileSync(
      "node",
      [DIST_CLI, "status", "--ledger", ".sortie/ledger.yaml"],
      { cwd: tmpDir, encoding: "utf-8" },
    );

    expect(stdout).toContain("a1b2c3d4-1");
    expect(stdout).toContain("feature/add-parser");
  });

  test("built dispose command updates verdict and ledger artifacts", () => {
    execSync("bun run build", { cwd: REPO_ROOT, stdio: "pipe" });

    tmpDir = mkdtempSync(join(tmpdir(), "sortie-cli-smoke-"));
    const ledgerFixture = loadFixture<{ runs: LedgerEntry[] }>("ledger-entries/multi-run.yaml");
    const verdictFixture = loadFixture<Verdict>("verdicts/fail.yaml");
    const sortieDir = join(tmpDir, ".sortie");
    const runId = ledgerFixture.runs[0].run_id;

    mkdirSync(join(sortieDir, runId), { recursive: true });
    writeFileSync(join(sortieDir, "ledger.yaml"), stringify(ledgerFixture), "utf-8");
    verdictFixture.run_id = runId;
    verdictFixture.tree_sha = ledgerFixture.runs[0].tree_sha;
    writeFileSync(
      join(sortieDir, runId, "verdict.yaml"),
      stringify(verdictFixture),
      "utf-8",
    );

    const stdout = execFileSync(
      "node",
      [
        DIST_CLI,
        "dispose",
        "--ledger",
        ".sortie/ledger.yaml",
        "--run-id",
        runId,
        "--finding",
        "CF001",
        "--disposition",
        "fixed",
      ],
      { cwd: tmpDir, encoding: "utf-8" },
    );

    expect(stdout).toContain("CF001 -> fixed");
    const verdictText = readFileSync(
      join(sortieDir, runId, "verdict.yaml"),
      "utf-8",
    );
    expect(verdictText).toContain("disposition: fixed");
  });

  test("built validate command exercises config loading and pipeline empty-diff handling", () => {
    execSync("bun run build", { cwd: REPO_ROOT, stdio: "pipe" });

    tmpDir = mkdtempSync(join(tmpdir(), "sortie-cli-smoke-"));
    writeHarnessConfig(tmpDir);
    initGitRepoWithOriginMain(tmpDir, "feature/empty-diff");

    const stdout = execFileSync(
      "node",
      [
        DIST_CLI,
        "validate",
        "--config",
        "harness.yaml",
        "--branch",
        "feature/empty-diff",
      ],
      { cwd: tmpDir, encoding: "utf-8" },
    );

    expect(stdout).toContain("Diff is empty");
  });
});
