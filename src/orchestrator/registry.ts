// Agent registry — definition parsing and lookup
// Part of the orchestrator subsystem.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SortieConfig } from "../harness/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
}

export interface RegistryEntry {
  config: SortieConfig;
  definition: AgentDefinition;
}

export interface SortieRegistry {
  /** Returns the registry entry for the given sortie name, or undefined. */
  get(name: string): RegistryEntry | undefined;
  /** Returns true if the source sortie is allowed to delegate to the target. */
  canDelegate(source: string, target: string): boolean;
  /** Returns a human-readable summary listing all sortie names and descriptions. */
  summary(): string;
  /** Returns all [name, entry] pairs in insertion order. */
  entries(): [string, RegistryEntry][];
}

// ---------------------------------------------------------------------------
// parseAgentDefinition
// ---------------------------------------------------------------------------

/**
 * Read a markdown file with YAML frontmatter and extract an AgentDefinition.
 *
 * The file must begin with a `---` frontmatter block containing at least
 * `name` and `model`. The body after the closing `---` becomes `systemPrompt`.
 *
 * Throws if the file cannot be read, has no frontmatter, or is missing
 * required fields.
 */
export function parseAgentDefinition(filePath: string): AgentDefinition {
  // readFileSync throws ENOENT if missing — propagate as-is
  const raw = readFileSync(filePath, "utf-8");

  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Missing or malformed frontmatter in: ${filePath}`);
  }

  const frontmatter = parseYaml(match[1]) as Record<string, unknown>;
  const body = match[2] ?? "";

  if (typeof frontmatter.name !== "string" || !frontmatter.name) {
    throw new Error(`Agent definition missing required field 'name' in: ${filePath}`);
  }

  if (typeof frontmatter.model !== "string" || !frontmatter.model) {
    throw new Error(`Agent definition missing required field 'model' in: ${filePath}`);
  }

  const description =
    typeof frontmatter.description === "string" ? frontmatter.description : "";

  return {
    name: frontmatter.name,
    description,
    model: frontmatter.model,
    systemPrompt: body,
  };
}

// ---------------------------------------------------------------------------
// buildRegistry
// ---------------------------------------------------------------------------

/**
 * Build a SortieRegistry from a sorties config map and a working directory.
 *
 * Each `SortieConfig.definition` path is resolved relative to `cwd`.
 * Throws if any definition file cannot be parsed.
 */
export function buildRegistry(
  sortiesConfig: Record<string, SortieConfig>,
  cwd: string
): SortieRegistry {
  const map = new Map<string, RegistryEntry>();

  for (const [name, config] of Object.entries(sortiesConfig)) {
    const absPath = join(cwd, config.definition);
    const definition = parseAgentDefinition(absPath);
    map.set(name, { config, definition });
  }

  return {
    get(name: string): RegistryEntry | undefined {
      return map.get(name);
    },

    canDelegate(source: string, target: string): boolean {
      const entry = map.get(source);
      if (!entry) return false;
      return entry.config.can_delegate_to.includes(target);
    },

    summary(): string {
      const lines: string[] = [];
      for (const [name, entry] of map.entries()) {
        lines.push(`${name}: ${entry.definition.description}`);
      }
      return lines.join("\n");
    },

    entries(): [string, RegistryEntry][] {
      return [...map.entries()];
    },
  };
}
