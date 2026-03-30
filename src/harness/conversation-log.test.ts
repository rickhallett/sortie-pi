// Conversation logger tests — SORTIE_PROTOCOL_v3.md
// Written FIRST (TDD red phase)

import { describe, test, expect } from "bun:test";
import { ConversationLogger } from "./conversation-log.js";
import type { LogEntry } from "./conversation-log.js";
import { join } from "node:path";
import { mkdtemp, rm, readFile, readdir, stat } from "node:fs/promises";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "convlog-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function entry(
  role: "user" | "assistant",
  content: string,
  timestamp = "2026-03-30T12:00:00Z",
): LogEntry {
  return { role, content, timestamp };
}

// ---------------------------------------------------------------------------
// addEntry + getEntries
// ---------------------------------------------------------------------------

describe("ConversationLogger", () => {
  test("addEntry() stores entries per reviewer", () => {
    const logger = new ConversationLogger();
    const e1 = entry("user", "Hello");
    const e2 = entry("assistant", "Hi there");

    logger.addEntry("claude-sonnet", e1);
    logger.addEntry("claude-sonnet", e2);

    const entries = logger.getEntries("claude-sonnet");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(e1);
    expect(entries[1]).toEqual(e2);
  });

  test("getEntries() returns entries for the correct reviewer only", () => {
    const logger = new ConversationLogger();
    logger.addEntry("claude-sonnet", entry("user", "question for claude"));
    logger.addEntry("gemini-pro", entry("user", "question for gemini"));

    expect(logger.getEntries("claude-sonnet")).toHaveLength(1);
    expect(logger.getEntries("claude-sonnet")[0].content).toBe(
      "question for claude",
    );
    expect(logger.getEntries("gemini-pro")).toHaveLength(1);
    expect(logger.getEntries("gemini-pro")[0].content).toBe(
      "question for gemini",
    );
  });

  test("getEntries() returns empty array for unknown reviewer", () => {
    const logger = new ConversationLogger();
    expect(logger.getEntries("nonexistent")).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // flush
  // ---------------------------------------------------------------------------

  test("flush() creates log files at correct path", async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      const logger = new ConversationLogger();
      logger.addEntry("claude-sonnet", entry("user", "ping"));

      logger.flush(dir);

      const logPath = join(dir, "logs", "sortie-claude-sonnet.log");
      const st = await stat(logPath);
      expect(st.isFile()).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test("flush() writes entries in correct format", async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      const logger = new ConversationLogger();
      const ts = "2026-03-30T12:00:00Z";
      logger.addEntry("claude-sonnet", entry("user", "Hello", ts));
      logger.addEntry(
        "claude-sonnet",
        entry("assistant", "Hi there", ts),
      );

      logger.flush(dir);

      const logPath = join(dir, "logs", "sortie-claude-sonnet.log");
      const content = await readFile(logPath, "utf-8");

      const expected = [
        `[${ts}] user: Hello`,
        "---",
        `[${ts}] assistant: Hi there`,
        "---",
        "", // trailing newline from final separator
      ].join("\n");

      expect(content).toBe(expected);
    } finally {
      await cleanup();
    }
  });

  test("flush() creates logs/ subdirectory", async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      const logger = new ConversationLogger();
      logger.addEntry("claude-sonnet", entry("user", "test"));

      logger.flush(dir);

      const logsDir = join(dir, "logs");
      const st = await stat(logsDir);
      expect(st.isDirectory()).toBe(true);
    } finally {
      await cleanup();
    }
  });

  // ---------------------------------------------------------------------------
  // Disabled logger
  // ---------------------------------------------------------------------------

  test("disabled logger: addEntry() is a no-op", () => {
    const logger = new ConversationLogger(false);
    logger.addEntry("claude-sonnet", entry("user", "should be ignored"));

    expect(logger.getEntries("claude-sonnet")).toEqual([]);
  });

  test("disabled logger: flush() writes nothing", async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      const logger = new ConversationLogger(false);
      // Even though we call addEntry (which is a no-op), flush should not
      // create any files or directories.
      logger.addEntry("claude-sonnet", entry("user", "nope"));
      logger.flush(dir);

      const entries = await readdir(dir);
      expect(entries).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  // ---------------------------------------------------------------------------
  // clear
  // ---------------------------------------------------------------------------

  test("clear() removes all entries", () => {
    const logger = new ConversationLogger();
    logger.addEntry("claude-sonnet", entry("user", "one"));
    logger.addEntry("gemini-pro", entry("user", "two"));

    logger.clear();

    expect(logger.getEntries("claude-sonnet")).toEqual([]);
    expect(logger.getEntries("gemini-pro")).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Multiple reviewers
  // ---------------------------------------------------------------------------

  test("multiple reviewers get separate log files", async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      const logger = new ConversationLogger();
      logger.addEntry("claude-sonnet", entry("user", "question A"));
      logger.addEntry("gemini-pro", entry("user", "question B"));

      logger.flush(dir);

      const logsDir = join(dir, "logs");
      const files = (await readdir(logsDir)).sort();
      expect(files).toEqual([
        "sortie-claude-sonnet.log",
        "sortie-gemini-pro.log",
      ]);

      const contentA = await readFile(
        join(logsDir, "sortie-claude-sonnet.log"),
        "utf-8",
      );
      expect(contentA).toContain("question A");
      expect(contentA).not.toContain("question B");

      const contentB = await readFile(
        join(logsDir, "sortie-gemini-pro.log"),
        "utf-8",
      );
      expect(contentB).toContain("question B");
      expect(contentB).not.toContain("question A");
    } finally {
      await cleanup();
    }
  });

  // ---------------------------------------------------------------------------
  // isEnabled
  // ---------------------------------------------------------------------------

  test("isEnabled() returns true by default", () => {
    const logger = new ConversationLogger();
    expect(logger.isEnabled()).toBe(true);
  });

  test("isEnabled() returns false when disabled", () => {
    const logger = new ConversationLogger(false);
    expect(logger.isEnabled()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Defensive behavior
  // ---------------------------------------------------------------------------

  describe("defensive behavior", () => {
    test("getEntries returns a copy — mutating it does not affect logger state", () => {
      const logger = new ConversationLogger(true);
      logger.addEntry("reviewer-a", { role: "user", content: "hello", timestamp: "2026-03-30T12:00:00Z" });
      const entries = logger.getEntries("reviewer-a");
      entries.push({ role: "assistant", content: "injected", timestamp: "2026-03-30T12:00:01Z" });
      // Logger's internal state should be unchanged
      expect(logger.getEntries("reviewer-a")).toHaveLength(1);
    });

    test("reviewer name with path separators is sanitized in filename", () => {
      const logger = new ConversationLogger(true);
      logger.addEntry("../../etc/passwd", { role: "user", content: "hack", timestamp: "2026-03-30T12:00:00Z" });
      const tmpDir = mkdtempSync(join(tmpdir(), "convo-test-"));
      try {
        logger.flush(tmpDir);
        // Should NOT create files outside logs/
        const logsDir = join(tmpDir, "logs");
        const files = readdirSync(logsDir);
        expect(files).toHaveLength(1);
        // Filename should be sanitized
        expect(files[0]).not.toContain("/");
        expect(files[0]).not.toContain("..");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("reviewer name with slashes gets underscores in filename", () => {
      const logger = new ConversationLogger(true);
      logger.addEntry("path/to/reviewer", { role: "user", content: "test", timestamp: "2026-03-30T12:00:00Z" });
      const tmpDir = mkdtempSync(join(tmpdir(), "convo-test-"));
      try {
        logger.flush(tmpDir);
        const files = readdirSync(join(tmpDir, "logs"));
        expect(files[0]).toBe("sortie-path_to_reviewer.log");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
