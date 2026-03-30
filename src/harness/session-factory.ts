// Session factory — the SOLE Pi SDK seam
// SORTIE_PROTOCOL_v3.md Section 16
//
// All other harness modules interact with sessions through this abstraction.
// Only this module directly calls createAgentSession() and getModel().

import { getModel } from "@mariozechner/pi-ai";
import {
  createAgentSession,
  readOnlyTools,
  codingTools,
  SessionManager,
  type ToolDefinition,
  type CreateAgentSessionOptions,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import type { RosterEntry, DebriefConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionOptions {
  cwd: string;
  customTools?: ToolDefinition[];
}

// ---------------------------------------------------------------------------
// resolveModel — pure function, delegates to Pi SDK getModel
// ---------------------------------------------------------------------------

/**
 * Resolve a provider/model string pair to a Pi SDK Model object.
 *
 * Throws if the provider or model is unknown.
 */
export function resolveModel(
  provider: string,
  modelId: string,
): ReturnType<typeof getModel> {
  // getModel is strongly typed with known providers/models.
  // We cast to satisfy the generic constraints since our config stores
  // provider and model as plain strings.
  const model = (getModel as any)(provider, modelId);
  if (!model) {
    throw new Error(
      `Unknown provider/model combination: ${provider}/${modelId}`,
    );
  }
  return model;
}

// ---------------------------------------------------------------------------
// Config builders — pure functions, no side effects, fully testable
// ---------------------------------------------------------------------------

/**
 * Build the CreateAgentSessionOptions for a reviewer session.
 *
 * Reviewer sessions use read-only tools (read, grep, find, ls — NO bash, write, edit).
 * They use in-memory session storage since no persistence is needed for validation runs.
 */
export function buildReviewerSessionConfig(
  entry: RosterEntry,
  options: SessionOptions,
): CreateAgentSessionOptions {
  return {
    cwd: options.cwd,
    model: resolveModel(entry.provider, entry.model),
    tools: readOnlyTools,
    sessionManager: SessionManager.inMemory(),
  };
}

/**
 * Build the CreateAgentSessionOptions for a lead (debrief) session.
 *
 * Lead sessions use coding tools (read, bash, edit, write) plus optional custom tools
 * for .sortie file writes. They use in-memory session storage.
 */
export function buildLeadSessionConfig(
  config: DebriefConfig,
  options: SessionOptions,
): CreateAgentSessionOptions {
  const sessionConfig: CreateAgentSessionOptions = {
    cwd: options.cwd,
    model: resolveModel(config.provider, config.model),
    tools: codingTools,
    sessionManager: SessionManager.inMemory(),
  };

  if (options.customTools && options.customTools.length > 0) {
    sessionConfig.customTools = options.customTools;
  }

  return sessionConfig;
}

// ---------------------------------------------------------------------------
// Session creators — thin wrappers around createAgentSession
// ---------------------------------------------------------------------------

/**
 * Create a reviewer session (read-only tools).
 *
 * Returns the session and a dispose function that safely tears down the session.
 */
export async function createReviewerSession(
  entry: RosterEntry,
  options: SessionOptions,
): Promise<{ session: AgentSession; dispose: () => void }> {
  const config = buildReviewerSessionConfig(entry, options);
  const { session } = await createAgentSession(config);

  return {
    session,
    dispose: () => {
      try {
        session.dispose();
      } catch {
        // Swallow dispose errors — session may already be disposed
      }
    },
  };
}

/**
 * Create a lead session (coding tools + custom tools for .sortie writes).
 *
 * Returns the session and a dispose function that safely tears down the session.
 */
export async function createLeadSession(
  config: DebriefConfig,
  options: SessionOptions,
): Promise<{ session: AgentSession; dispose: () => void }> {
  const sessionConfig = buildLeadSessionConfig(config, options);
  const { session } = await createAgentSession(sessionConfig);

  return {
    session,
    dispose: () => {
      try {
        session.dispose();
      } catch {
        // Swallow dispose errors — session may already be disposed
      }
    },
  };
}
