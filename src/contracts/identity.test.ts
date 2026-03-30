import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import {
  treeSha8,
  runId,
  runDir,
  nextCycle,
  getTreeSha,
} from "./identity.js";

describe("treeSha8", () => {
  test("extracts first 8 characters of a tree SHA", () => {
    const sha = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
    expect(treeSha8(sha)).toBe("a1b2c3d4");
  });

  test("works with any valid 40-char hex string", () => {
    const sha = "0000000011111111222222223333333344444444";
    expect(treeSha8(sha)).toBe("00000000");
  });
});

describe("runId", () => {
  test("formats as {sha8}-{cycle}", () => {
    const sha = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
    expect(runId(sha, 1)).toBe("a1b2c3d4-1");
  });

  test("handles multi-digit cycle numbers", () => {
    const sha = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
    expect(runId(sha, 42)).toBe("a1b2c3d4-42");
  });
});

describe("runDir", () => {
  test("joins depositionDir with runId", () => {
    const sha = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
    expect(runDir(".sortie", sha, 1)).toBe(join(".sortie", "a1b2c3d4-1"));
  });

  test("works with absolute deposition paths", () => {
    const sha = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
    expect(runDir("/tmp/depositions", sha, 3)).toBe(
      join("/tmp/depositions", "a1b2c3d4-3"),
    );
  });
});

describe("nextCycle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sortie-identity-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns 1 when depositionDir is empty", () => {
    expect(nextCycle(tmpDir, "a1b2c3d4")).toBe(1);
  });

  test("returns 1 when depositionDir does not exist", () => {
    const nonexistent = join(tmpDir, "does-not-exist");
    expect(nextCycle(nonexistent, "a1b2c3d4")).toBe(1);
  });

  test("returns 2 when one matching dir exists", () => {
    mkdirSync(join(tmpDir, "a1b2c3d4-1"));
    expect(nextCycle(tmpDir, "a1b2c3d4")).toBe(2);
  });

  test("returns N+1 for N existing dirs with same prefix", () => {
    mkdirSync(join(tmpDir, "a1b2c3d4-1"));
    mkdirSync(join(tmpDir, "a1b2c3d4-2"));
    mkdirSync(join(tmpDir, "a1b2c3d4-3"));
    expect(nextCycle(tmpDir, "a1b2c3d4")).toBe(4);
  });

  test("ignores dirs with different SHA prefixes", () => {
    mkdirSync(join(tmpDir, "a1b2c3d4-1"));
    mkdirSync(join(tmpDir, "ffffffff-1"));
    mkdirSync(join(tmpDir, "ffffffff-2"));
    expect(nextCycle(tmpDir, "a1b2c3d4")).toBe(2);
  });

  test("handles non-sequential cycle numbers (returns max+1)", () => {
    mkdirSync(join(tmpDir, "a1b2c3d4-1"));
    mkdirSync(join(tmpDir, "a1b2c3d4-5"));
    expect(nextCycle(tmpDir, "a1b2c3d4")).toBe(6);
  });
});

describe("getTreeSha", () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = mkdtempSync(join(tmpdir(), "sortie-git-test-"));
    execSync("git init", { cwd: tmpRepo });
    execSync("git config user.email 'test@test.com'", { cwd: tmpRepo });
    execSync("git config user.name 'Test'", { cwd: tmpRepo });
    // Create a file, add it to the index so write-tree works
    execSync("echo 'hello' > file.txt", { cwd: tmpRepo });
    execSync("git add file.txt", { cwd: tmpRepo });
  });

  afterEach(() => {
    rmSync(tmpRepo, { recursive: true, force: true });
  });

  test("returns a 40-character lowercase hex string", () => {
    const sha = getTreeSha(tmpRepo);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  test("returns consistent SHA for same content", () => {
    const sha1 = getTreeSha(tmpRepo);
    const sha2 = getTreeSha(tmpRepo);
    expect(sha1).toBe(sha2);
  });

  test("returns different SHA for different content", () => {
    const sha1 = getTreeSha(tmpRepo);
    execSync("echo 'world' > file2.txt", { cwd: tmpRepo });
    execSync("git add file2.txt", { cwd: tmpRepo });
    const sha2 = getTreeSha(tmpRepo);
    expect(sha1).not.toBe(sha2);
  });
});
