import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = join(import.meta.dir, "../..");

const AGENTS = [
  "orchestrator.md",
  "validation-lead.md",
  "reviewer-claude.md",
  "reviewer-gemini.md",
  "reviewer-codex.md",
];

function readAgent(name: string): string {
  return readFileSync(join(ROOT, ".pi/agents", name), "utf-8");
}

function parseFrontmatter(name: string): Record<string, unknown> {
  const content = readAgent(name);
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    throw new Error(`Missing frontmatter in ${name}`);
  }
  return parse(match[1]) as Record<string, unknown>;
}

describe("agent definitions", () => {
  test("all expected agent files exist", () => {
    for (const name of AGENTS) {
      expect(existsSync(join(ROOT, ".pi/agents", name))).toBe(true);
    }
  });

  test("all agent files include required frontmatter keys", () => {
    for (const name of AGENTS) {
      const frontmatter = parseFrontmatter(name);
      expect(typeof frontmatter.name).toBe("string");
      expect(typeof frontmatter.description).toBe("string");
      expect(typeof frontmatter.model).toBe("string");
      expect(Array.isArray(frontmatter.tools)).toBe(true);
      expect((frontmatter.tools as unknown[]).length).toBeGreaterThan(0);
    }
  });

  test("reviewers are read-only and require YAML-only output", () => {
    for (const name of [
      "reviewer-claude.md",
      "reviewer-gemini.md",
      "reviewer-codex.md",
    ]) {
      const content = readAgent(name);
      expect(content).toContain("read-only");
      expect(content).toContain("no write, no edit, no bash");
      expect(content).toContain("strict YAML only");
      expect(content).toContain("verdict rules");
    }
  });

  test("validation lead references sortie tools and .sortie write scope", () => {
    const content = readAgent("validation-lead.md");
    const frontmatter = parseFrontmatter("validation-lead.md");
    expect(content).toContain("sortie custom tools");
    expect(content).toContain(".sortie/**");
    expect(content).toContain("strict Sortie YAML only");
    expect(frontmatter.tools).not.toContain(".sortie/**");
    expect(frontmatter.write_scope).toBe(".sortie/**");
  });

  test("orchestrator is delegate-only and zero-write", () => {
    const content = readAgent("orchestrator.md");
    expect(content).toContain("Delegate-only");
    expect(content).toContain("Zero writes");
    expect(content).toContain("Do not edit repository files");
  });
});
