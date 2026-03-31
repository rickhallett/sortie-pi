// Orchestrator bootstrap — builds OrchestratorConfig from harness config.
// Part of the orchestrator subsystem.

import { resolve } from "node:path";
import type { ToolDefinition, AgentSession } from "@mariozechner/pi-coding-agent";
import {
  createAgentSession,
  readOnlyTools,
  codingTools,
  SessionManager,
  DefaultResourceLoader,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { loadHarnessConfig } from "../harness/config.js";
import { buildRegistry, type SortieRegistry } from "./registry.js";
import { createDelegateTool, type DelegateToolDeps } from "./delegate-tool.js";
import { sortieCustomTools } from "../tools/index.js";
import { createDomainLock } from "../harness/domain-lock.js";

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

// ---------------------------------------------------------------------------
// Tool name → Pi SDK built-in tool resolution
// ---------------------------------------------------------------------------

const BUILTIN_TOOL_SETS: Record<string, string> = {
  read: "readOnly",
  grep: "readOnly",
  find: "readOnly",
  ls: "readOnly",
  write: "coding",
  edit: "coding",
  bash: "coding",
};

function resolveBuiltinTools(toolNames: string[]): any[] {
  const needsCoding = toolNames.some(
    (t) => BUILTIN_TOOL_SETS[t] === "coding",
  );
  return needsCoding ? codingTools : readOnlyTools;
}

// ---------------------------------------------------------------------------
// createSortieSession — real Pi SDK session for a delegate child
// ---------------------------------------------------------------------------

async function createSortieSession(
  config: {
    model: string;
    systemPrompt: string;
    tools: string[];
    cwd: string;
    writeScope?: string;
  },
  registry: SortieRegistry,
  parentCwd: string,
): Promise<{ session: AgentSession; dispose: () => void }> {
  // Resolve model — try provider/model split, fallback to name-based lookup
  const model = (getModel as any)(config.model) ?? (getModel as any)("anthropic", config.model);
  if (!model) {
    throw new Error(`Cannot resolve model: ${config.model}`);
  }

  // Resolve built-in tools
  const builtinTools = resolveBuiltinTools(config.tools);

  // Resolve custom tools (sortie-* tools + delegate if allowed)
  const customTools: ToolDefinition[] = [];
  for (const tool of sortieCustomTools) {
    if (config.tools.includes(tool.name)) {
      customTools.push(tool);
    }
  }

  // If this sortie can delegate, wire a real delegate tool for it
  if (config.tools.includes("delegate")) {
    // Find the sortie name from registry by matching systemPrompt
    let sortieName = "unknown";
    for (const [name, entry] of registry.entries()) {
      if (entry.definition.systemPrompt === config.systemPrompt) {
        sortieName = name;
        break;
      }
    }

    const delegateDeps: DelegateToolDeps = {
      registry,
      callerName: sortieName,
      cwd: parentCwd,
      createSession: (childConfig) =>
        createSortieSession(childConfig, registry, parentCwd),
      sendProgress: () => {}, // TODO: wire to parent session when SDK supports it
    };
    customTools.push(createDelegateTool(delegateDeps) as unknown as ToolDefinition);
  }

  const resourceLoader = new DefaultResourceLoader({
    cwd: config.cwd,
    systemPrompt: config.systemPrompt,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });

  const { session } = await createAgentSession({
    cwd: config.cwd,
    model,
    tools: builtinTools,
    customTools: customTools.length > 0 ? customTools : undefined,
    sessionManager: SessionManager.inMemory(),
    resourceLoader,
  });

  return {
    session,
    dispose: () => {
      try {
        session.dispose();
      } catch {
        // Swallow dispose errors
      }
    },
  };
}

// ---------------------------------------------------------------------------
// startOrchestrator — create a live orchestrator session
// ---------------------------------------------------------------------------

export async function startOrchestrator(
  configPath: string,
  cwd: string,
): Promise<{ session: AgentSession; dispose: () => void }> {
  const orchConfig = buildOrchestratorConfig(configPath, cwd);

  // Rebuild custom tools with real delegate wiring
  const wiredTools: ToolDefinition[] = [];

  for (const tool of sortieCustomTools) {
    if (orchConfig.customTools.some((t) => t.name === tool.name)) {
      wiredTools.push(tool);
    }
  }

  // Wire the real delegate tool
  const delegateDeps: DelegateToolDeps = {
    registry: orchConfig.registry,
    callerName: "orchestrator",
    cwd,
    createSession: (childConfig) =>
      createSortieSession(childConfig, orchConfig.registry, cwd),
    sendProgress: () => {}, // TODO: wire to session sendCustomMessage when available
  };
  wiredTools.push(createDelegateTool(delegateDeps) as unknown as ToolDefinition);

  // Resolve orchestrator model
  const model = (getModel as any)(orchConfig.model) ?? (getModel as any)("anthropic", orchConfig.model);
  if (!model) {
    throw new Error(`Cannot resolve orchestrator model: ${orchConfig.model}`);
  }

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    systemPrompt: orchConfig.systemPrompt,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });

  const { session } = await createAgentSession({
    cwd,
    model,
    tools: readOnlyTools,
    customTools: wiredTools.length > 0 ? wiredTools : undefined,
    sessionManager: SessionManager.inMemory(),
    resourceLoader,
  });

  return {
    session,
    dispose: () => {
      try {
        session.dispose();
      } catch {
        // Swallow dispose errors
      }
    },
  };
}
