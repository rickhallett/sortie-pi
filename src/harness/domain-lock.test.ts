// Domain lock tests — SORTIE_PROTOCOL_v3.md Section 14.3: Reviewers MUST be read-only
// Written FIRST (TDD red phase)

import { describe, test, expect } from "bun:test";
import { createDomainLock, createReadOnlyLock } from "./domain-lock.js";
import type { ToolCallCheck, LockDecision } from "./domain-lock.js";

// ---------------------------------------------------------------------------
// Read-only tools are ALWAYS allowed
// ---------------------------------------------------------------------------

describe("createDomainLock — read-only tools always allowed", () => {
  const lock = createDomainLock([]);

  test("read tool is allowed", () => {
    const result = lock({ tool: "read", path: "/any/file.ts" });
    expect(result.allowed).toBe(true);
  });

  test("grep tool is allowed", () => {
    const result = lock({ tool: "grep", path: "/any/file.ts" });
    expect(result.allowed).toBe(true);
  });

  test("find tool is allowed", () => {
    const result = lock({ tool: "find" });
    expect(result.allowed).toBe(true);
  });

  test("ls tool is allowed", () => {
    const result = lock({ tool: "ls" });
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Empty patterns (read-only lock) blocks write, edit, bash
// ---------------------------------------------------------------------------

describe("createDomainLock — empty patterns (read-only)", () => {
  const lock = createDomainLock([]);

  test("blocks write tool", () => {
    const result = lock({ tool: "write", path: "src/index.ts" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBeString();
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  test("blocks edit tool", () => {
    const result = lock({ tool: "edit", path: "src/index.ts" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBeString();
    }
  });

  test("blocks bash tool", () => {
    const result = lock({ tool: "bash", command: "echo hello" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBeString();
    }
  });
});

// ---------------------------------------------------------------------------
// .sortie/** pattern — allows writes within .sortie, blocks elsewhere
// ---------------------------------------------------------------------------

describe("createDomainLock — .sortie/** pattern", () => {
  const lock = createDomainLock([".sortie/**"], "/workspace/project");

  test("allows write to .sortie/abc-1/verdict.yaml", () => {
    const result = lock({ tool: "write", path: ".sortie/abc-1/verdict.yaml" });
    expect(result.allowed).toBe(true);
  });

  test("allows edit to .sortie/deep/nested/file.ts", () => {
    const result = lock({ tool: "edit", path: ".sortie/deep/nested/file.ts" });
    expect(result.allowed).toBe(true);
  });

  test("blocks write to src/index.ts", () => {
    const result = lock({ tool: "write", path: "src/index.ts" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("src/index.ts");
    }
  });

  test("blocks edit to README.md", () => {
    const result = lock({ tool: "edit", path: "README.md" });
    expect(result.allowed).toBe(false);
  });

  test("blocks bash even when patterns exist (VULN-001)", () => {
    const result = lock({ tool: "bash", command: "echo hello" });
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multiple patterns
// ---------------------------------------------------------------------------

describe("createDomainLock — multiple patterns", () => {
  const lock = createDomainLock([".sortie/**", "prompts/**"], "/workspace/project");

  test("allows write to .sortie/abc-1/verdict.yaml", () => {
    const result = lock({ tool: "write", path: ".sortie/abc-1/verdict.yaml" });
    expect(result.allowed).toBe(true);
  });

  test("allows write to prompts/debrief.md", () => {
    const result = lock({ tool: "write", path: "prompts/debrief.md" });
    expect(result.allowed).toBe(true);
  });

  test("allows write to prompts/nested/template.md", () => {
    const result = lock({ tool: "write", path: "prompts/nested/template.md" });
    expect(result.allowed).toBe(true);
  });

  test("blocks write to src/index.ts", () => {
    const result = lock({ tool: "write", path: "src/index.ts" });
    expect(result.allowed).toBe(false);
  });

  test("blocks write to package.json", () => {
    const result = lock({ tool: "write", path: "package.json" });
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Single-level wildcard (*)
// ---------------------------------------------------------------------------

describe("createDomainLock — single-level wildcard", () => {
  const lock = createDomainLock(["prompts/*.md"], "/workspace/project");

  test("allows write to prompts/debrief.md", () => {
    const result = lock({ tool: "write", path: "prompts/debrief.md" });
    expect(result.allowed).toBe(true);
  });

  test("blocks write to prompts/nested/debrief.md (single * does not cross /)", () => {
    const result = lock({ tool: "write", path: "prompts/nested/debrief.md" });
    expect(result.allowed).toBe(false);
  });

  test("blocks write to prompts/debrief.txt (extension mismatch)", () => {
    const result = lock({ tool: "write", path: "prompts/debrief.txt" });
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Exact file path pattern
// ---------------------------------------------------------------------------

describe("createDomainLock — exact file path", () => {
  const lock = createDomainLock([".sortie/ledger.yaml"], "/workspace/project");

  test("allows write to exact path", () => {
    const result = lock({ tool: "write", path: ".sortie/ledger.yaml" });
    expect(result.allowed).toBe(true);
  });

  test("blocks write to other file in same directory", () => {
    const result = lock({ tool: "write", path: ".sortie/other.yaml" });
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createReadOnlyLock convenience function
// ---------------------------------------------------------------------------

describe("createReadOnlyLock", () => {
  const lock = createReadOnlyLock();

  test("allows read tool", () => {
    const result = lock({ tool: "read", path: "src/index.ts" });
    expect(result.allowed).toBe(true);
  });

  test("allows grep tool", () => {
    const result = lock({ tool: "grep" });
    expect(result.allowed).toBe(true);
  });

  test("allows find tool", () => {
    const result = lock({ tool: "find" });
    expect(result.allowed).toBe(true);
  });

  test("allows ls tool", () => {
    const result = lock({ tool: "ls" });
    expect(result.allowed).toBe(true);
  });

  test("blocks write tool", () => {
    const result = lock({ tool: "write", path: "src/index.ts" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBeString();
    }
  });

  test("blocks edit tool", () => {
    const result = lock({ tool: "edit", path: "src/index.ts" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBeString();
    }
  });

  test("blocks bash tool", () => {
    const result = lock({ tool: "bash", command: "rm -rf /" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBeString();
    }
  });
});

// ---------------------------------------------------------------------------
// Unknown tools are allowed (future-proof)
// ---------------------------------------------------------------------------

describe("createDomainLock — unknown tools", () => {
  const lock = createDomainLock([]);

  test("unknown tool name is allowed", () => {
    const result = lock({ tool: "some_future_tool" });
    expect(result.allowed).toBe(true);
  });

  test("another unknown tool is allowed with patterns", () => {
    const lockWithPatterns = createDomainLock([".sortie/**"], "/workspace/project");
    const result = lockWithPatterns({ tool: "fancy_inspect" });
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reason string quality
// ---------------------------------------------------------------------------

describe("createDomainLock — reason strings", () => {
  const lock = createDomainLock([".sortie/**"], "/workspace/project");

  test("blocked write reason mentions the path", () => {
    const result = lock({ tool: "write", path: "src/main.ts" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("src/main.ts");
    }
  });

  test("blocked write reason mentions the tool", () => {
    const result = lock({ tool: "write", path: "src/main.ts" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("write");
    }
  });

  test("blocked edit reason mentions the tool", () => {
    const result = lock({ tool: "edit", path: "src/main.ts" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("edit");
    }
  });

  test("bash block explains why", () => {
    const bashLock = createDomainLock([".sortie/**"], "/workspace/project");
    const result = bashLock({ tool: "bash", command: "echo hello" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("bash");
    }
  });
});

// ---------------------------------------------------------------------------
// Path traversal prevention
// ---------------------------------------------------------------------------

describe("path traversal prevention", () => {
  const cwd = "/workspace/project";

  test(".sortie/../src/index.ts is blocked by .sortie/** pattern", () => {
    const lock = createDomainLock([".sortie/**"], cwd);
    const result = lock({ tool: "write", path: ".sortie/../src/index.ts" });
    expect(result.allowed).toBe(false);
  });

  test(".sortie/./verdict.yaml is allowed (normalizes to .sortie/verdict.yaml)", () => {
    const lock = createDomainLock([".sortie/**"], cwd);
    const result = lock({ tool: "write", path: ".sortie/./verdict.yaml" });
    expect(result.allowed).toBe(true);
  });

  test(".sortie/abc/../def/verdict.yaml is allowed (stays within .sortie/)", () => {
    const lock = createDomainLock([".sortie/**"], cwd);
    const result = lock({ tool: "write", path: ".sortie/abc/../def/verdict.yaml" });
    expect(result.allowed).toBe(true);
  });

  test("../../../etc/passwd is blocked", () => {
    const lock = createDomainLock([".sortie/**"], cwd);
    const result = lock({ tool: "write", path: "../../../etc/passwd" });
    expect(result.allowed).toBe(false);
  });

  test(".sortie/../../outside is blocked (traverses out)", () => {
    const lock = createDomainLock([".sortie/**"], cwd);
    const result = lock({ tool: "edit", path: ".sortie/../../outside" });
    expect(result.allowed).toBe(false);
  });

  test("absolute path /etc/passwd is blocked even with ** pattern", () => {
    const lock = createDomainLock([".sortie/**"], cwd);
    const result = lock({ tool: "write", path: "/etc/passwd" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("outside workspace");
    }
  });

  test("absolute path /etc/passwd.ts is blocked even with **/*.ts pattern", () => {
    const lock = createDomainLock(["**/*.ts"], cwd);
    const result = lock({ tool: "write", path: "/etc/passwd.ts" });
    expect(result.allowed).toBe(false);
  });

  test("absolute path matching pattern prefix is blocked if outside cwd", () => {
    const lock = createDomainLock([".sortie/**"], "/home/user/project");
    const result = lock({ tool: "write", path: "/tmp/.sortie/evil.yaml" });
    expect(result.allowed).toBe(false);
  });

  test("relative path resolves against cwd for containment check", () => {
    const lock = createDomainLock([".sortie/**"], "/home/user/project");
    const result = lock({ tool: "write", path: ".sortie/run-1/verdict.yaml" });
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bash tool is ALWAYS blocked in domain-locked sessions (VULN-001)
// ---------------------------------------------------------------------------

describe("bash tool always blocked in domain-locked sessions", () => {
  test("bash blocked even when write patterns exist", () => {
    const lock = createDomainLock([".sortie/**"], "/workspace");
    const result = lock({ tool: "bash", command: "echo hello" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("bash");
    }
  });

  test("bash blocked with multiple write patterns", () => {
    const lock = createDomainLock([".sortie/**", "prompts/**"], "/workspace");
    const result = lock({ tool: "bash", command: "cat file.txt" });
    expect(result.allowed).toBe(false);
  });

  test("bash blocked reason explains sandbox bypass risk", () => {
    const lock = createDomainLock([".sortie/**"], "/workspace");
    const result = lock({ tool: "bash", command: "rm -rf /" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("bash");
      expect(result.reason).toContain("bypass");
    }
  });
});

// ---------------------------------------------------------------------------
// write/edit without a path — should be blocked
// ---------------------------------------------------------------------------

describe("createDomainLock — write/edit without path", () => {
  const lock = createDomainLock([".sortie/**"], "/workspace/project");

  test("write without path is blocked", () => {
    const result = lock({ tool: "write" });
    expect(result.allowed).toBe(false);
  });

  test("edit without path is blocked", () => {
    const result = lock({ tool: "edit" });
    expect(result.allowed).toBe(false);
  });
});
