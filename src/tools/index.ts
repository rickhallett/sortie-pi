import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { triageTool } from "./triage-tool.js";
import { ledgerTool } from "./ledger-tool.js";
import { identityTool } from "./identity-tool.js";

export { triageTool } from "./triage-tool.js";
export { ledgerTool } from "./ledger-tool.js";
export { identityTool } from "./identity-tool.js";

// ToolDefinition is invariant on TParams, so we cast through unknown for the heterogeneous array.
export const sortieCustomTools: ToolDefinition[] = [
  triageTool as unknown as ToolDefinition,
  ledgerTool as unknown as ToolDefinition,
  identityTool as unknown as ToolDefinition,
];
