// Delegate custom tool — spawns a child agent session and returns the result.
// Part of the orchestrator subsystem.

import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { SortieRegistry } from "./registry.js";
import { emitProgress, type SendFn } from "./progress.js";

// ---------------------------------------------------------------------------
// Dependencies — injected to keep the tool testable
// ---------------------------------------------------------------------------

export interface DelegateToolDeps {
  registry: SortieRegistry;
  callerName: string;
  cwd: string;
  createSession: (config: {
    model: string;
    systemPrompt: string;
    tools: string[];
    cwd: string;
    writeScope?: string;
  }) => Promise<{ session: AgentSession; dispose: () => void }>;
  sendProgress: SendFn;
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const DelegateParams = Type.Object({
  sortie: Type.String({ description: "Name of the sortie to delegate to (from config)" }),
  task: Type.String({ description: "Natural language task description for the sortie" }),
  context: Type.Optional(Type.String({ description: "Additional context from the parent agent" })),
});

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

interface DelegateResult {
  sortie: string;
  result: string | null;
  tokens: { input: number; output: number; total: number } | null;
  cost: number | null;
  wall_time_ms: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a `sortie-delegate` custom tool bound to the given dependencies.
 *
 * The tool validates delegation permissions, spawns a child session,
 * prompts it with the task (and optional context), and returns the result
 * as JSON. The child session is always disposed, even on error.
 */
export function createDelegateTool(
  deps: DelegateToolDeps,
): ToolDefinition<typeof DelegateParams> {
  return {
    name: "sortie-delegate",
    label: "Sortie Delegate",
    description:
      "Delegate a task to another sortie agent. The target sortie must be in this agent's can_delegate_to list.",
    parameters: DelegateParams,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { sortie: targetName, task, context } = params;

      // 1. Validate sortie exists in registry
      const entry = deps.registry.get(targetName);
      if (!entry) {
        const result: DelegateResult = {
          sortie: targetName,
          result: null,
          tokens: null,
          cost: null,
          wall_time_ms: 0,
          error: `Unknown sortie: "${targetName}" — not found in registry`,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          details: {},
        };
      }

      // 2. Validate caller can delegate to this sortie
      if (!deps.registry.canDelegate(deps.callerName, targetName)) {
        const result: DelegateResult = {
          sortie: targetName,
          result: null,
          tokens: null,
          cost: null,
          wall_time_ms: 0,
          error: `Delegation not allowed: "${deps.callerName}" is not allowed to delegate to "${targetName}"`,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          details: {},
        };
      }

      // 3. Emit progress: starting
      emitProgress(deps.sendProgress, targetName, "starting...");

      const startTime = Date.now();
      let dispose: (() => void) | undefined;

      try {
        // 4. Create child session
        const created = await deps.createSession({
          model: entry.definition.model,
          systemPrompt: entry.definition.systemPrompt,
          tools: entry.config.tools,
          cwd: deps.cwd,
          writeScope: entry.config.write_scope,
        });
        dispose = created.dispose;
        const { session } = created;

        // 5. Build prompt
        const prompt = context
          ? `## Context\n\n${context}\n\n## Task\n\n${task}`
          : task;

        // 6. Emit progress: working
        emitProgress(deps.sendProgress, targetName, "working...");

        // 7. Await session.prompt
        await session.prompt(prompt);

        // 8. Capture result and stats
        const responseText = session.getLastAssistantText() ?? null;
        const stats = session.getSessionStats();
        const wallTimeMs = Date.now() - startTime;

        // 9. Emit progress: complete
        emitProgress(deps.sendProgress, targetName, `complete (${wallTimeMs}ms)`);

        // 10. Return JSON-stringified result
        const result: DelegateResult = {
          sortie: targetName,
          result: responseText,
          tokens: {
            input: stats.tokens.input,
            output: stats.tokens.output,
            total: stats.tokens.total,
          },
          cost: stats.cost,
          wall_time_ms: wallTimeMs,
          error: null,
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          details: {},
        };
      } catch (err) {
        // 11. On error: return error result
        const wallTimeMs = Date.now() - startTime;
        const message = err instanceof Error ? err.message : String(err);

        const result: DelegateResult = {
          sortie: targetName,
          result: null,
          tokens: null,
          cost: null,
          wall_time_ms: wallTimeMs,
          error: message,
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          details: {},
        };
      } finally {
        // 12. Always dispose in finally block
        if (dispose) {
          try {
            dispose();
          } catch {
            // Swallow dispose errors
          }
        }
      }
    },
  };
}
