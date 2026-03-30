// Domain lock — SORTIE_PROTOCOL_v3.md Section 14.3
// Restricts tool calls to enforce read-only or pattern-scoped write access.

import { normalize } from "node:path";

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
 * - `write` / `edit` tools are allowed only when the file path matches
 *   at least one write pattern.
 * - `bash` tool: blocked entirely when writePatterns is empty (read-only
 *   agent). When patterns exist, allowed (bash commands cannot be reliably
 *   parsed for write detection).
 * - Unknown tool names are allowed (future-proof).
 */
export function createDomainLock(
  writePatterns: string[],
): (check: ToolCallCheck) => LockDecision {
  const compiled = writePatterns.map(globToRegExp);
  const isReadOnly = writePatterns.length === 0;

  return (check: ToolCallCheck): LockDecision => {
    const { tool, path } = check;

    // Read-only tools are always allowed
    if (READ_ONLY_TOOLS.has(tool)) {
      return { allowed: true };
    }

    // Write / edit tools — check path against patterns
    if (WRITE_TOOLS.has(tool)) {
      if (path == null) {
        return {
          allowed: false,
          reason: `${tool} tool call has no path — cannot verify domain lock`,
        };
      }
      const normalizedPath = normalize(path);
      if (matchesAnyPattern(normalizedPath, compiled)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `${tool} to "${path}" blocked — path does not match any write pattern`,
      };
    }

    // Bash tool — blocked in read-only mode, allowed otherwise
    if (tool === "bash") {
      if (isReadOnly) {
        return {
          allowed: false,
          reason: "bash tool blocked — agent is in read-only mode (no write patterns)",
        };
      }
      return { allowed: true };
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
