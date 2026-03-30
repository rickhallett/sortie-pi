// Bootstrap tests — TDD red phase

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildOrchestratorConfig } from "./bootstrap.js";

// ---------------------------------------------------------------------------
// Workspace setup helper
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function setupWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bootstrap-test-"));
  tempDirs.push(dir);

  // Create .pi/agents/ with orchestrator and test-worker definitions
  await mkdir(join(dir, ".pi", "agents"), { recursive: true });
  await writeFile(
    join(dir, ".pi", "agents", "orchestrator.md"),
    [
      "---",
      "name: orchestrator",
      "description: Main orchestrator for sortie runs.",
      "model: claude-opus",
      "---",
      "",
      "You are the orchestrator. Coordinate all validation work.",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    join(dir, ".pi", "agents", "test-worker.md"),
    [
      "---",
      "name: test-worker",
      "description: Worker agent for testing.",
      "model: claude-sonnet",
      "---",
      "",
      "You are a test worker.",
    ].join("\n"),
    "utf-8",
  );

  // Create prompts directory
  await mkdir(join(dir, "prompts"), { recursive: true });
  await writeFile(
    join(dir, "prompts", "sortie-code.md"),
    "Review the code changes for correctness.",
    "utf-8",
  );
  await writeFile(
    join(dir, "prompts", "debrief.md"),
    "Synthesize the review findings.",
    "utf-8",
  );

  // Write harness.yaml with sorties section
  const harnessYaml = [
    "project: test-project",
    "roster:",
    "  - name: claude",
    "    provider: anthropic",
    "    model: claude-sonnet-4-20250514",
    "debrief:",
    "  model: claude-sonnet-4-20250514",
    "  provider: anthropic",
    "  prompt_template: prompts/debrief.md",
    "triage:",
    "  block_on: [critical, major]",
    "modes:",
    "  code:",
    "    prompt_template: prompts/sortie-code.md",
    "sorties:",
    "  orchestrator:",
    "    definition: .pi/agents/orchestrator.md",
    "    tools: [delegate, sortie-triage]",
    "    can_delegate_to: [test-worker]",
    "  test-worker:",
    "    definition: .pi/agents/test-worker.md",
    "    tools: [sortie-triage]",
    "    can_delegate_to: []",
  ].join("\n");
  await writeFile(join(dir, "harness.yaml"), harnessYaml, "utf-8");

  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildOrchestratorConfig", () => {
  test("builds orchestrator config with registry, tools, and system prompt", async () => {
    const cwd = await setupWorkspace();
    const config = buildOrchestratorConfig("harness.yaml", cwd);

    // Model comes from orchestrator agent definition
    expect(config.model).toBe("claude-opus");

    // System prompt contains the orchestrator body
    expect(config.systemPrompt).toContain("You are the orchestrator");

    // System prompt also contains registry summary (test-worker name)
    expect(config.systemPrompt).toContain("test-worker");

    // customTools includes the delegate tool
    const toolNames = config.customTools.map((t) => t.name);
    expect(toolNames).toContain("sortie-delegate");

    // registry has test-worker entry
    const workerEntry = config.registry.get("test-worker");
    expect(workerEntry).toBeDefined();
    expect(workerEntry!.definition.name).toBe("test-worker");

    // cwd is returned as-is
    expect(config.cwd).toBe(cwd);
  });

  test("throws when config has no sorties section", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bootstrap-nosort-"));
    tempDirs.push(dir);

    // Minimal harness.yaml without sorties
    await mkdir(join(dir, "prompts"), { recursive: true });
    await writeFile(join(dir, "prompts", "sortie-code.md"), "Review.", "utf-8");
    await writeFile(join(dir, "prompts", "debrief.md"), "Synthesize.", "utf-8");

    const noSortiesYaml = [
      "project: test-project",
      "roster:",
      "  - name: claude",
      "    provider: anthropic",
      "    model: claude-sonnet-4-20250514",
      "debrief:",
      "  model: claude-sonnet-4-20250514",
      "  provider: anthropic",
      "  prompt_template: prompts/debrief.md",
      "triage:",
      "  block_on: [critical]",
      "modes:",
      "  code:",
      "    prompt_template: prompts/sortie-code.md",
    ].join("\n");
    await writeFile(join(dir, "harness.yaml"), noSortiesYaml, "utf-8");

    expect(() => buildOrchestratorConfig("harness.yaml", dir)).toThrow(/no sorties/i);
  });
});
