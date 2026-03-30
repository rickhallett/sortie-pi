// Domain lock — SORTIE_PROTOCOL_v3.md Section 14.3
// Restricts tool calls to enforce read-only or pattern-scoped write access.

import { normalize, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCallCheck {
  tool: string;       // tool name: "write", "edit", "bash", "read", etc.
  path?: string;      // file path for write/edit tools
  command?: string;   // command string for bash tool
}

export type LockDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

// ---------------------------------------------------------------------------
// Read-only tool set
// ---------------------------------------------------------------------------

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);

// ---------------------------------------------------------------------------
// Mutating tool set
// ---------------------------------------------------------------------------

const WRITE_TOOLS = new Set(["write", "edit"]);

// ---------------------------------------------------------------------------
// Glob matching (no external deps)
// ---------------------------------------------------------------------------

/**
 * Convert a simple glob pattern to a RegExp.
 *
 * Supported syntax:
 *   `**`  — matches zero or more path segments (including separators)
 *   `*`   — matches any characters except `/`
 *   `.`   — literal dot (escaped)
 *
 * This is intentionally minimal — enough for path-prefix and
 * single-directory wildcards without pulling in `minimatch`.
 */
function globToRegExp(pattern: string): RegExp {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      // ** — match anything including path separators
      re += ".*";
      i += 2;
      // skip trailing slash after ** (e.g. `**/`)
      if (pattern[i] === "/") {
        i++;
      }
    } else if (ch === "*") {
      // * — match anything except /
      re += "[^/]*";
      i++;
    } else if (ch === "?") {
      re += "[^/]";
      i++;
    } else if (".+^${}()|[]\\".includes(ch)) {
      re += "\\" + ch;
      i++;
    } else {
      re += ch;
      i++;
    }
  }
  return new RegExp("^" + re + "$");
}

function matchesAnyPattern(path: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(path));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a domain lock checker from write patterns.
 *
 * - Read-only tools (`read`, `grep`, `find`, `ls`) are always allowed.
 * - `write` / `edit` tools are allowed only when the file path resolves
 *   to a location within `cwd` AND matches at least one write pattern.
 * - `bash` tool: always blocked in domain-locked sessions. Bash can
 *   bypass file-path restrictions via shell commands (VULN-001).
 * - Unknown tool names are allowed (future-proof).
 *
 * @param writePatterns — glob patterns for allowed write paths (relative to cwd)
 * @param cwd — workspace root for path containment checks
 */
export function createDomainLock(
  writePatterns: string[],
  cwd?: string,
): (check: ToolCallCheck) => LockDecision {
  const compiled = writePatterns.map(globToRegExp);
  // Normalize cwd with trailing separator for startsWith check
  const resolvedCwd = cwd ? resolve(cwd) : undefined;

  return (check: ToolCallCheck): LockDecision => {
    const { tool, path } = check;

    // Read-only tools are always allowed
    if (READ_ONLY_TOOLS.has(tool)) {
      return { allowed: true };
    }

    // Write / edit tools — check containment + pattern
    if (WRITE_TOOLS.has(tool)) {
      if (path == null) {
        return {
          allowed: false,
          reason: `${tool} tool call has no path — cannot verify domain lock`,
        };
      }

      // Resolve against cwd for containment check
      const resolvedPath = resolvedCwd
        ? resolve(resolvedCwd, path)
        : resolve(path);

      // Containment check: resolved path must be within workspace root
      if (resolvedCwd && !resolvedPath.startsWith(resolvedCwd + "/") && resolvedPath !== resolvedCwd) {
        return {
          allowed: false,
          reason: `${tool} to "${path}" blocked — path resolves outside workspace root`,
        };
      }

      // Normalize relative to cwd for pattern matching
      const normalizedPath = resolvedCwd
        ? normalize(resolvedPath.slice(resolvedCwd.length + 1))
        : normalize(path);

      if (matchesAnyPattern(normalizedPath, compiled)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `${tool} to "${path}" blocked — path does not match any write pattern`,
      };
    }

    // Bash tool — always blocked in domain-locked sessions (VULN-001)
    // Bash can bypass file-path restrictions via shell commands.
    if (tool === "bash") {
      return {
        allowed: false,
        reason: "bash tool blocked — can bypass domain lock file-path restrictions",
      };
    }

    // Unknown tools — allowed (future-proof)
    return { allowed: true };
  };
}

/**
 * Convenience: create a read-only lock that blocks all writes.
 * Equivalent to `createDomainLock([])`.
 */
export function createReadOnlyLock(): (check: ToolCallCheck) => LockDecision {
  return createDomainLock([]);
}
