import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Get the 8-char prefix of a tree SHA.
 */
export function treeSha8(treeSha: string): string {
  return treeSha.slice(0, 8);
}

/**
 * Format a run ID from a full tree SHA and cycle number.
 * Format: {tree_sha_8}-{cycle}
 */
export function runId(treeSha: string, cycle: number): string {
  return `${treeSha8(treeSha)}-${cycle}`;
}

/**
 * Format the run directory path by joining depositionDir with the run ID.
 */
export function runDir(
  depositionDir: string,
  treeSha: string,
  cycle: number,
): string {
  return join(depositionDir, runId(treeSha, cycle));
}

/**
 * Compute the next cycle number for a given tree SHA prefix.
 * Scans depositionDir for directories matching `{sha8}-*`,
 * returns max(existing cycles) + 1, or 1 if none found.
 */
export function nextCycle(depositionDir: string, sha8: string): number {
  let entries: string[];
  try {
    entries = readdirSync(depositionDir);
  } catch {
    return 1;
  }

  const prefix = `${sha8}-`;
  let maxCycle = 0;

  for (const entry of entries) {
    if (entry.startsWith(prefix)) {
      const suffix = entry.slice(prefix.length);
      const cycle = parseInt(suffix, 10);
      if (!Number.isNaN(cycle) && cycle > maxCycle) {
        maxCycle = cycle;
      }
    }
  }

  return maxCycle + 1;
}

/**
 * Get the tree SHA from a git repository by running `git write-tree`.
 * Validates the result is a 40-character lowercase hexadecimal string.
 */
export function getTreeSha(repoPath: string): string {
  const result = execSync("git write-tree", { cwd: repoPath, encoding: "utf8" }).trim();

  if (!/^[0-9a-f]{40}$/.test(result)) {
    throw new Error(
      `git write-tree returned invalid SHA: "${result}" (expected 40-char lowercase hex)`,
    );
  }

  return result;
}
