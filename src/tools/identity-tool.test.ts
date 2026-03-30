import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { identityTool } from "./identity-tool.js";

/** Extract text from the first content block of a tool result. */
function textOf(result: { content: { type: string; text?: string }[] }): string {
  const block = result.content[0];
  if (block.type !== "text" || typeof block.text !== "string") {
    throw new Error("Expected text content block");
  }
  return block.text;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = {} as any;

describe("sortie-identity tool", () => {
  test("has correct name, label, and description", () => {
    expect(identityTool.name).toBe("sortie-identity");
    expect(identityTool.label).toBe("Sortie Identity");
    expect(typeof identityTool.description).toBe("string");
    expect(identityTool.description.length).toBeGreaterThan(0);
  });

  describe("action: tree-sha", () => {
    let tmpRepo: string;

    beforeEach(() => {
      tmpRepo = mkdtempSync(join(tmpdir(), "sortie-identity-tool-test-"));
      execSync("git init", { cwd: tmpRepo });
      execSync("git config user.email 'test@test.com'", { cwd: tmpRepo });
      execSync("git config user.name 'Test'", { cwd: tmpRepo });
      execSync("echo 'hello' > file.txt", { cwd: tmpRepo });
      execSync("git add file.txt", { cwd: tmpRepo });
    });

    afterEach(() => {
      rmSync(tmpRepo, { recursive: true, force: true });
    });

    test("returns a 40-character hex tree SHA", async () => {
      const result = await identityTool.execute(
        "call-1",
        { action: "tree-sha", repo_path: tmpRepo },
        undefined,
        undefined,
        ctx,
      );

      const text = textOf(result);
      expect(text).toMatch(/^[0-9a-f]{40}$/);
    });

    test("returns consistent SHA for same content", async () => {
      const result1 = await identityTool.execute(
        "call-2a",
        { action: "tree-sha", repo_path: tmpRepo },
        undefined,
        undefined,
        ctx,
      );
      const result2 = await identityTool.execute(
        "call-2b",
        { action: "tree-sha", repo_path: tmpRepo },
        undefined,
        undefined,
        ctx,
      );

      expect(textOf(result1)).toBe(textOf(result2));
    });
  });

  describe("action: next-cycle", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "sortie-identity-cycle-test-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("returns 1 for empty deposition dir", async () => {
      const result = await identityTool.execute(
        "call-3",
        { action: "next-cycle", deposition_dir: tmpDir, tree_sha_8: "a1b2c3d4" },
        undefined,
        undefined,
        ctx,
      );

      expect(textOf(result)).toBe("1");
    });

    test("returns N+1 for existing cycle directories", async () => {
      mkdirSync(join(tmpDir, "a1b2c3d4-1"));
      mkdirSync(join(tmpDir, "a1b2c3d4-2"));

      const result = await identityTool.execute(
        "call-4",
        { action: "next-cycle", deposition_dir: tmpDir, tree_sha_8: "a1b2c3d4" },
        undefined,
        undefined,
        ctx,
      );

      expect(textOf(result)).toBe("3");
    });

    test("ignores dirs with different SHA prefix", async () => {
      mkdirSync(join(tmpDir, "a1b2c3d4-1"));
      mkdirSync(join(tmpDir, "ffffffff-1"));
      mkdirSync(join(tmpDir, "ffffffff-2"));

      const result = await identityTool.execute(
        "call-5",
        { action: "next-cycle", deposition_dir: tmpDir, tree_sha_8: "a1b2c3d4" },
        undefined,
        undefined,
        ctx,
      );

      expect(textOf(result)).toBe("2");
    });
  });

  describe("action: run-id", () => {
    test("formats as {sha8}-{cycle}", async () => {
      const result = await identityTool.execute(
        "call-6",
        {
          action: "run-id",
          tree_sha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
          cycle: 3,
        },
        undefined,
        undefined,
        ctx,
      );

      expect(textOf(result)).toBe("a1b2c3d4-3");
    });

    test("handles cycle 1", async () => {
      const result = await identityTool.execute(
        "call-7",
        {
          action: "run-id",
          tree_sha: "0000000011111111222222223333333344444444",
          cycle: 1,
        },
        undefined,
        undefined,
        ctx,
      );

      expect(textOf(result)).toBe("00000000-1");
    });
  });

  describe("malformed input handling", () => {
    test("returns error message for unknown action", async () => {
      const result = await identityTool.execute(
        "call-err-1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { action: "bogus" as any },
        undefined,
        undefined,
        ctx,
      );

      const text = textOf(result);
      expect(text.toLowerCase()).toContain("unknown action");
    });

    test("returns error message when repo_path is missing for tree-sha action", async () => {
      const result = await identityTool.execute(
        "call-err-2",
        { action: "tree-sha" },
        undefined,
        undefined,
        ctx,
      );

      const text = textOf(result);
      expect(text).toMatch(/^Error: /);
    });

    test("returns error message when repo_path is invalid for tree-sha action", async () => {
      const result = await identityTool.execute(
        "call-err-3",
        { action: "tree-sha", repo_path: "/tmp/nonexistent-repo-xyz999" },
        undefined,
        undefined,
        ctx,
      );

      const text = textOf(result);
      expect(text).toMatch(/^Error: /);
    });

    test("returns error message when tree_sha is missing for run-id action", async () => {
      const result = await identityTool.execute(
        "call-err-4",
        { action: "run-id", cycle: 1 },
        undefined,
        undefined,
        ctx,
      );

      const text = textOf(result);
      expect(text).toMatch(/^Error: /);
    });

    test("returns error message when deposition_dir is missing for next-cycle action", async () => {
      const result = await identityTool.execute(
        "call-err-5",
        { action: "next-cycle", tree_sha_8: "a1b2c3d4" },
        undefined,
        undefined,
        ctx,
      );

      const text = textOf(result);
      expect(text).toMatch(/^Error: /);
    });
  });
});
