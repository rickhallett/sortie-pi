// Conversation Logger — captures session transcripts per reviewer for
// debugging and audit.  Part of the Sortie Pi harness.

import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogEntry {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sanitize reviewer name for safe use in filenames. */
function sanitizeReviewerName(name: string): string {
  // Remove path separators and parent directory traversals
  return name.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
}

// ---------------------------------------------------------------------------
// ConversationLogger
// ---------------------------------------------------------------------------

export class ConversationLogger {
  private entries: Map<string, LogEntry[]> = new Map();

  constructor(private enabled: boolean = true) {}

  /** Add a log entry for a reviewer. No-op when logging is disabled. */
  addEntry(reviewerName: string, entry: LogEntry): void {
    if (!this.enabled) return;

    let list = this.entries.get(reviewerName);
    if (!list) {
      list = [];
      this.entries.set(reviewerName, list);
    }
    list.push(entry);
  }

  /** Get all entries for a reviewer (empty array if unknown). Returns a defensive copy. */
  getEntries(reviewerName: string): LogEntry[] {
    return [...(this.entries.get(reviewerName) ?? [])];
  }

  /**
   * Write all logs to disk under `{runDir}/logs/sortie-{reviewerName}.log`.
   * Creates the `logs/` subdirectory if it does not exist.
   * No-op when logging is disabled or there are no entries.
   */
  flush(runDir: string): void {
    if (!this.enabled || this.entries.size === 0) return;

    const logsDir = join(runDir, "logs");
    mkdirSync(logsDir, { recursive: true });

    for (const [reviewer, entries] of this.entries) {
      const lines: string[] = [];
      for (const e of entries) {
        lines.push(`[${e.timestamp}] ${e.role}: ${e.content}`);
        lines.push("---");
      }
      const safeName = sanitizeReviewerName(reviewer);
      const filePath = join(logsDir, `sortie-${safeName}.log`);
      writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
    }
  }

  /** Check if logging is enabled. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Clear all captured entries. */
  clear(): void {
    this.entries.clear();
  }
}
