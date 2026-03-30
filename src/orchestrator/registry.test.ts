// Agent registry tests — TDD red phase

import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import type { SortieConfig } from "../harness/config.js";
import { parseAgentDefinition, buildRegistry } from "./registry.js";

const FIXTURES_DIR = join(import.meta.dir, "../../fixtures");
const CWD = join(import.meta.dir, "../..");

// ---------------------------------------------------------------------------
// parseAgentDefinition
// ---------------------------------------------------------------------------

describe("parseAgentDefinition", () => {
  test("parses frontmatter name, description, and model", () => {
    const def = parseAgentDefinition(join(FIXTURES_DIR, "sorties/test-agent.md"));
    expect(def.name).toBe("test-agent");
    expect(def.description).toBe("Test agent for unit tests.");
    expect(def.model).toBe("claude-sonnet-4-20250514");
  });

  test("body after frontmatter becomes systemPrompt", () => {
    const def = parseAgentDefinition(join(FIXTURES_DIR, "sorties/test-agent.md"));
    expect(def.systemPrompt.trim()).toBe("You are a test agent. Follow instructions exactly.");
  });

  test("throws on missing file", () => {
    expect(() =>
      parseAgentDefinition(join(FIXTURES_DIR, "sorties/does-not-exist.md"))
    ).toThrow();
  });

  test("throws when name is missing from frontmatter", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "registry-test-"));
    const file = join(dir, "bad.md");
    await writeFile(file, "---\ndescription: No name here\nmodel: claude\n---\nBody.\n", "utf-8");
    try {
      expect(() => parseAgentDefinition(file)).toThrow(/name/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("throws when model is missing from frontmatter", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "registry-test-"));
    const file = join(dir, "bad.md");
    await writeFile(file, "---\nname: some-agent\ndescription: No model here\n---\nBody.\n", "utf-8");
    try {
      expect(() => parseAgentDefinition(file)).toThrow(/model/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// buildRegistry
// ---------------------------------------------------------------------------

describe("buildRegistry", () => {
  const sortiesConfig: Record<string, SortieConfig> = {
    "test-agent": {
      definition: "fixtures/sorties/test-agent.md",
      tools: ["read", "grep"],
      can_delegate_to: ["other-agent"],
    },
  };

  test("builds registry with resolved definitions", () => {
    const registry = buildRegistry(sortiesConfig, CWD);
    const entry = registry.get("test-agent");
    expect(entry).toBeDefined();
    expect(entry!.definition.name).toBe("test-agent");
    expect(entry!.definition.description).toBe("Test agent for unit tests.");
    expect(entry!.definition.model).toBe("claude-sonnet-4-20250514");
    expect(entry!.config.tools).toEqual(["read", "grep"]);
  });

  test("returns undefined for unknown sortie", () => {
    const registry = buildRegistry(sortiesConfig, CWD);
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  test("canDelegate returns true when target is in can_delegate_to", () => {
    const registry = buildRegistry(sortiesConfig, CWD);
    expect(registry.canDelegate("test-agent", "other-agent")).toBe(true);
  });

  test("canDelegate returns false when target is not in can_delegate_to", () => {
    const registry = buildRegistry(sortiesConfig, CWD);
    expect(registry.canDelegate("test-agent", "unknown-agent")).toBe(false);
  });

  test("canDelegate returns false for unknown source sortie", () => {
    const registry = buildRegistry(sortiesConfig, CWD);
    expect(registry.canDelegate("nonexistent", "other-agent")).toBe(false);
  });

  test("summary returns human-readable text with sortie names and descriptions", () => {
    const registry = buildRegistry(sortiesConfig, CWD);
    const text = registry.summary();
    expect(text).toContain("test-agent");
    expect(text).toContain("Test agent for unit tests.");
  });

  test("entries returns all registry entries", () => {
    const registry = buildRegistry(sortiesConfig, CWD);
    const all = registry.entries();
    expect(all.length).toBe(1);
    expect(all[0][0]).toBe("test-agent");
  });

  test("builds registry with multiple sorties", () => {
    const multiConfig: Record<string, SortieConfig> = {
      "test-agent": {
        definition: "fixtures/sorties/test-agent.md",
        tools: ["read"],
        can_delegate_to: ["other"],
      },
      "another-agent": {
        definition: "fixtures/sorties/test-agent.md",
        tools: ["write"],
        can_delegate_to: [],
      },
    };
    const registry = buildRegistry(multiConfig, CWD);
    const summary = registry.summary();
    expect(summary).toContain("test-agent");
    expect(summary).toContain("another-agent");
    expect(registry.entries().length).toBe(2);
  });
});
