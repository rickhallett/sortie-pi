import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadHarnessConfig } from "./config.js";
import { assembleReviewerPrompt, loadTemplate } from "./prompt.js";

const ROOT = join(import.meta.dir, "../..");

function readPrompt(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf-8");
}

describe("prompt assets", () => {
  test("all harness prompt paths exist and are loadable", async () => {
    const config = loadHarnessConfig(join(ROOT, "harness.yaml"));

    expect(existsSync(join(ROOT, config.debrief.prompt_template))).toBe(true);
    await expect(loadTemplate(join(ROOT, config.debrief.prompt_template))).resolves.toContain(
      "{sortie_outputs}",
    );

    for (const mode of Object.values(config.modes)) {
      const fullPath = join(ROOT, mode.prompt_template);
      expect(existsSync(fullPath)).toBe(true);
      await expect(loadTemplate(fullPath)).resolves.toContain("{branch}");
    }
  });

  test("reviewer prompts include read-only tool guidance and YAML-only output rules", () => {
    for (const relativePath of [
      "prompts/sortie-code.md",
      "prompts/sortie-tests.md",
      "prompts/sortie-docs.md",
    ]) {
      const prompt = readPrompt(relativePath);
      expect(prompt).toContain("{branch}");
      expect(prompt).toContain("read");
      expect(prompt).toContain("grep");
      expect(prompt).toContain("find");
      expect(prompt).toContain("ls");
      expect(prompt).toContain("YAML only");
      expect(prompt).toContain("No prose outside the YAML");
      expect(prompt).toContain("Do not use write, edit, or bash");
    }
  });

  test("actual reviewer prompt assets assemble correctly", () => {
    for (const relativePath of [
      "prompts/sortie-code.md",
      "prompts/sortie-tests.md",
      "prompts/sortie-docs.md",
    ]) {
      const prompt = assembleReviewerPrompt(
        readPrompt(relativePath),
        "@@ -1,1 +1,2 @@\n+line",
        "feature/asset-test",
      );
      expect(prompt).toContain("feature/asset-test");
      expect(prompt).toContain("```diff");
      expect(prompt).toContain("+line");
    }
  });

  test("debrief prompt includes aggregation placeholders and YAML-only rules", () => {
    const prompt = readPrompt("prompts/debrief.md");
    expect(prompt).toContain("{n}");
    expect(prompt).toContain("{tree_sha}");
    expect(prompt).toContain("{branch}");
    expect(prompt).toContain("{sortie_outputs}");
    expect(prompt).toContain("YAML only");
    expect(prompt).toContain("No prose outside the YAML");
  });
});
