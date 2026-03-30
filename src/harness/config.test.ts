// Harness config loader tests — SORTIE_PROTOCOL_v3.md Section 16
// Written FIRST (TDD red phase)

import { describe, test, expect } from "bun:test";
import { loadHarnessConfig } from "./config.js";
import type { HarnessConfig } from "./config.js";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeTempYaml(content: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "config-test-"));
  const path = join(dir, "harness.yaml");
  await writeFile(path, content, "utf-8");
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const VALID_YAML = `
project: test-project

roster:
  - name: claude-sonnet
    provider: anthropic
    model: claude-sonnet-4-20250514
    timeout: 120000
  - name: gemini-pro
    provider: google
    model: gemini-2.5-pro

debrief:
  model: claude-sonnet-4-20250514
  provider: anthropic
  prompt_template: prompts/debrief.md

triage:
  block_on: ["critical", "major"]
  convergence_threshold: 2
  max_remediation_cycles: 2

modes:
  code:
    prompt_template: prompts/sortie-code.md
  tests:
    prompt_template: prompts/sortie-tests.md
    roster: ["claude-sonnet"]
    debrief_template: prompts/debrief-tests.md
    triage:
      block_on: ["critical"]

deposition_dir: .sortie
ledger_path: .sortie/ledger.yaml
`;

// ---------------------------------------------------------------------------
// Valid config
// ---------------------------------------------------------------------------

describe("loadHarnessConfig — valid config", () => {
  test("loads all fields correctly", async () => {
    const { path, cleanup } = await writeTempYaml(VALID_YAML);
    try {
      const cfg = loadHarnessConfig(path);
      expect(cfg.project).toBe("test-project");
      expect(cfg.roster).toHaveLength(2);
      expect(cfg.roster[0].name).toBe("claude-sonnet");
      expect(cfg.roster[0].provider).toBe("anthropic");
      expect(cfg.roster[0].model).toBe("claude-sonnet-4-20250514");
      expect(cfg.roster[0].timeout).toBe(120000);
      expect(cfg.roster[1].name).toBe("gemini-pro");
      expect(cfg.roster[1].timeout).toBeUndefined();
      expect(cfg.debrief.model).toBe("claude-sonnet-4-20250514");
      expect(cfg.debrief.provider).toBe("anthropic");
      expect(cfg.debrief.prompt_template).toBe("prompts/debrief.md");
      expect(cfg.triage.block_on).toEqual(["critical", "major"]);
      expect(cfg.triage.convergence_threshold).toBe(2);
      expect(cfg.triage.max_remediation_cycles).toBe(2);
      expect(Object.keys(cfg.modes)).toEqual(["code", "tests"]);
      expect(cfg.modes.code.prompt_template).toBe("prompts/sortie-code.md");
      expect(cfg.modes.tests.roster).toEqual(["claude-sonnet"]);
      expect(cfg.modes.tests.debrief_template).toBe("prompts/debrief-tests.md");
      expect(cfg.modes.tests.triage).toEqual({ block_on: ["critical"] });
      expect(cfg.deposition_dir).toBe(".sortie");
      expect(cfg.ledger_path).toBe(".sortie/ledger.yaml");
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Missing required fields
// ---------------------------------------------------------------------------

describe("loadHarnessConfig — missing required fields", () => {
  test("missing project throws", async () => {
    const yaml = `
roster:
  - name: a
    provider: p
    model: m
debrief:
  model: m
  provider: p
  prompt_template: t
triage:
  block_on: ["critical"]
modes:
  code:
    prompt_template: t
`;
    const { path, cleanup } = await writeTempYaml(yaml);
    try {
      expect(() => loadHarnessConfig(path)).toThrow(/project/i);
    } finally {
      await cleanup();
    }
  });

  test("missing roster throws", async () => {
    const yaml = `
project: test
debrief:
  model: m
  provider: p
  prompt_template: t
triage:
  block_on: ["critical"]
modes:
  code:
    prompt_template: t
`;
    const { path, cleanup } = await writeTempYaml(yaml);
    try {
      expect(() => loadHarnessConfig(path)).toThrow(/roster/i);
    } finally {
      await cleanup();
    }
  });

  test("empty roster throws", async () => {
    const yaml = `
project: test
roster: []
debrief:
  model: m
  provider: p
  prompt_template: t
triage:
  block_on: ["critical"]
modes:
  code:
    prompt_template: t
`;
    const { path, cleanup } = await writeTempYaml(yaml);
    try {
      expect(() => loadHarnessConfig(path)).toThrow(/roster/i);
    } finally {
      await cleanup();
    }
  });

  test("missing debrief throws", async () => {
    const yaml = `
project: test
roster:
  - name: a
    provider: p
    model: m
triage:
  block_on: ["critical"]
modes:
  code:
    prompt_template: t
`;
    const { path, cleanup } = await writeTempYaml(yaml);
    try {
      expect(() => loadHarnessConfig(path)).toThrow(/debrief/i);
    } finally {
      await cleanup();
    }
  });

  test("missing triage throws", async () => {
    const yaml = `
project: test
roster:
  - name: a
    provider: p
    model: m
debrief:
  model: m
  provider: p
  prompt_template: t
modes:
  code:
    prompt_template: t
`;
    const { path, cleanup } = await writeTempYaml(yaml);
    try {
      expect(() => loadHarnessConfig(path)).toThrow(/triage/i);
    } finally {
      await cleanup();
    }
  });

  test("missing modes throws", async () => {
    const yaml = `
project: test
roster:
  - name: a
    provider: p
    model: m
debrief:
  model: m
  provider: p
  prompt_template: t
triage:
  block_on: ["critical"]
`;
    const { path, cleanup } = await writeTempYaml(yaml);
    try {
      expect(() => loadHarnessConfig(path)).toThrow(/modes/i);
    } finally {
      await cleanup();
    }
  });

  test("empty modes throws", async () => {
    const yaml = `
project: test
roster:
  - name: a
    provider: p
    model: m
debrief:
  model: m
  provider: p
  prompt_template: t
triage:
  block_on: ["critical"]
modes: {}
`;
    const { path, cleanup } = await writeTempYaml(yaml);
    try {
      expect(() => loadHarnessConfig(path)).toThrow(/modes/i);
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe("loadHarnessConfig — defaults", () => {
  test("default deposition_dir applied when omitted", async () => {
    const yaml = `
project: test
roster:
  - name: a
    provider: p
    model: m
debrief:
  model: m
  provider: p
  prompt_template: t
triage:
  block_on: ["critical"]
modes:
  code:
    prompt_template: t
`;
    const { path, cleanup } = await writeTempYaml(yaml);
    try {
      const cfg = loadHarnessConfig(path);
      expect(cfg.deposition_dir).toBe(".sortie");
    } finally {
      await cleanup();
    }
  });

  test("default ledger_path applied when omitted", async () => {
    const yaml = `
project: test
roster:
  - name: a
    provider: p
    model: m
debrief:
  model: m
  provider: p
  prompt_template: t
triage:
  block_on: ["critical"]
modes:
  code:
    prompt_template: t
`;
    const { path, cleanup } = await writeTempYaml(yaml);
    try {
      const cfg = loadHarnessConfig(path);
      expect(cfg.ledger_path).toBe(".sortie/ledger.yaml");
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Mode overrides
// ---------------------------------------------------------------------------

describe("loadHarnessConfig — mode overrides", () => {
  test("mode with triage override replaces top-level triage", async () => {
    const { path, cleanup } = await writeTempYaml(VALID_YAML);
    try {
      const cfg = loadHarnessConfig(path);
      expect(cfg.modes.tests.triage).toBeDefined();
      expect(cfg.modes.tests.triage!.block_on).toEqual(["critical"]);
      // Top-level triage unchanged
      expect(cfg.triage.block_on).toEqual(["critical", "major"]);
    } finally {
      await cleanup();
    }
  });

  test("mode with roster subset returns only named entries", async () => {
    const { path, cleanup } = await writeTempYaml(VALID_YAML);
    try {
      const cfg = loadHarnessConfig(path);
      expect(cfg.modes.tests.roster).toEqual(["claude-sonnet"]);
      // code mode has no roster override
      expect(cfg.modes.code.roster).toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Nested schema validation
// ---------------------------------------------------------------------------

/** Helper: valid YAML minus one field, for splicing in bad nested values. */
function makeYaml(overrides: Record<string, string>): string {
  const base: Record<string, string> = {
    project: "project: test",
    roster: `roster:\n  - name: a\n    provider: p\n    model: m`,
    debrief: `debrief:\n  model: m\n  provider: p\n  prompt_template: t`,
    triage: `triage:\n  block_on: ["critical"]`,
    modes: `modes:\n  code:\n    prompt_template: t`,
  };
  const merged = { ...base, ...overrides };
  return Object.values(merged).join("\n");
}

describe("loadHarnessConfig — nested schema validation", () => {
  test("roster[0].name: 1 (numeric name) throws", async () => {
    const yaml = makeYaml({
      roster: `roster:\n  - name: 1\n    provider: p\n    model: m`,
    });
    const { path, cleanup } = await writeTempYaml(yaml);
    try {
      expect(() => loadHarnessConfig(path)).toThrow(/roster\[0\]\.name/);
    } finally {
      await cleanup();
    }
  });

  test("roster[0] missing provider throws", async () => {
    const yaml = makeYaml({
      roster: `roster:\n  - name: a\n    model: m`,
    });
    const { path, cleanup } = await writeTempYaml(yaml);
    try {
      expect(() => loadHarnessConfig(path)).toThrow(/roster\[0\]\.provider/);
    } finally {
      await cleanup();
    }
  });

  test("triage.block_on as string (not array) throws", async () => {
    const yaml = makeYaml({
      triage: `triage:\n  block_on: "critical"`,
    });
    const { path, cleanup } = await writeTempYaml(yaml);
    try {
      expect(() => loadHarnessConfig(path)).toThrow(/triage\.block_on/);
    } finally {
      await cleanup();
    }
  });

  test("triage.block_on: [42] (non-string element) throws", async () => {
    const yaml = makeYaml({
      triage: `triage:\n  block_on: [42]`,
    });
    const { path, cleanup } = await writeTempYaml(yaml);
    try {
      expect(() => loadHarnessConfig(path)).toThrow(/triage\.block_on\[0\]/);
    } finally {
      await cleanup();
    }
  });

  test("modes.code.prompt_template: 42 (numeric) throws", async () => {
    const yaml = makeYaml({
      modes: `modes:\n  code:\n    prompt_template: 42`,
    });
    const { path, cleanup } = await writeTempYaml(yaml);
    try {
      expect(() => loadHarnessConfig(path)).toThrow(/modes\.code\.prompt_template/);
    } finally {
      await cleanup();
    }
  });

  test("debrief.model missing throws", async () => {
    const yaml = makeYaml({
      debrief: `debrief:\n  provider: p\n  prompt_template: t`,
    });
    const { path, cleanup } = await writeTempYaml(yaml);
    try {
      expect(() => loadHarnessConfig(path)).toThrow(/debrief\.model/);
    } finally {
      await cleanup();
    }
  });

  test("debrief.provider: 123 (numeric) throws", async () => {
    const yaml = makeYaml({
      debrief: `debrief:\n  model: m\n  provider: 123\n  prompt_template: t`,
    });
    const { path, cleanup } = await writeTempYaml(yaml);
    try {
      expect(() => loadHarnessConfig(path)).toThrow(/debrief\.provider/);
    } finally {
      await cleanup();
    }
  });
});
