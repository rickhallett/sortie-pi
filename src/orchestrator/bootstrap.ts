// Orchestrator bootstrap — builds OrchestratorConfig from harness config.
// Part of the orchestrator subsystem.

import { resolve } from "node:path";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { loadHarnessConfig } from "../harness/config.js";
import { buildRegistry, type SortieRegistry } from "./registry.js";
import { createDelegateTool, type DelegateToolDeps } from "./delegate-tool.js";
import { sortieCustomTools } from "../tools/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrchestratorConfig {
  model: string;
  systemPrompt: string;
  customTools: ToolDefinition[];
  registry: SortieRegistry;
  cwd: string;
}

// ---------------------------------------------------------------------------
// buildOrchestratorConfig
// ---------------------------------------------------------------------------

/**
 * Build the configuration needed to create an orchestrator session.
 *
 * Steps:
 * 1. Load harness config from `resolve(cwd, configPath)`
 * 2. Throw if config has no sorties section
 * 3. Build the sortie registry
 * 4. Locate the orchestrator entry in the registry (role: orchestrator, or first non-worker)
 * 5. Build system prompt: agent body + registry summary
 * 6. Resolve custom tools from the orchestrator's tool list
 * 7. Wire delegate tool with placeholder deps if "delegate" is in the tool list
 * 8. Return OrchestratorConfig
 */
export function buildOrchestratorConfig(configPath: string, cwd: string): OrchestratorConfig {
  // 1. Load config
  const absConfigPath = resolve(cwd, configPath);
  const config = loadHarnessConfig(absConfigPath);

  // 2. Require sorties section
  if (!config.sorties) {
    throw new Error("No sorties section in harness config — cannot build orchestrator config");
  }

  // 3. Build registry
  const registry = buildRegistry(config.sorties, cwd);

  // 4. Find orchestrator entry: prefer role === "orchestrator" or undefined role, else first entry
  //    Per the valid-config.yaml, the orchestrator entry is named "orchestrator" with no explicit role.
  //    We look for a sortie that has role === "orchestrator" or is listed as the config-level
  //    orchestrator key. Fall back to the first entry.
  let orchestratorName: string | undefined;

  for (const [name, sortieConf] of Object.entries(config.sorties)) {
    if (name === "orchestrator" || sortieConf.role === "orchestrator") {
      orchestratorName = name;
      break;
    }
  }

  // If no explicit "orchestrator" key, take the first entry
  if (!orchestratorName) {
    const firstEntry = registry.entries()[0];
    if (!firstEntry) {
      throw new Error("Registry is empty — cannot locate orchestrator entry");
    }
    orchestratorName = firstEntry[0];
  }

  const orchestratorEntry = registry.get(orchestratorName);
  if (!orchestratorEntry) {
    throw new Error(`Orchestrator entry "${orchestratorName}" not found in registry`);
  }

  // 5. Build system prompt
  const systemPrompt =
    orchestratorEntry.definition.systemPrompt +
    "\n\nAvailable sorties:\n" +
    registry.summary();

  // 6. Resolve custom tools from tool list
  const toolList = orchestratorEntry.config.tools;
  const tools: ToolDefinition[] = [];

  for (const tool of sortieCustomTools) {
    if (toolList.includes(tool.name)) {
      tools.push(tool);
    }
  }

  // 7. Wire delegate tool if in tool list
  if (toolList.includes("delegate")) {
    const placeholderDeps: DelegateToolDeps = {
      registry,
      callerName: orchestratorName,
      cwd,
      createSession: async (_cfg) => {
        throw new Error(
          "createSession not wired — delegate tool requires session wiring at runtime",
        );
      },
      sendProgress: (_msg) => {
        // no-op placeholder — real wiring happens at session creation time
      },
    };
    tools.push(createDelegateTool(placeholderDeps) as unknown as ToolDefinition);
  }

  return {
    model: orchestratorEntry.definition.model,
    systemPrompt,
    customTools: tools,
    registry,
    cwd,
  };
}
