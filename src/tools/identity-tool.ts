import { Type, type Static } from "@sinclair/typebox";
import { getTreeSha, nextCycle, runId } from "../contracts/identity.js";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

const IdentityParams = Type.Object({
  action: Type.Union(
    [
      Type.Literal("tree-sha"),
      Type.Literal("next-cycle"),
      Type.Literal("run-id"),
    ],
    { description: "Identity action to perform" },
  ),
  repo_path: Type.Optional(Type.String({ description: "Path to the git repository (for tree-sha action)" })),
  deposition_dir: Type.Optional(
    Type.String({ description: "Path to the deposition directory (for next-cycle action)" }),
  ),
  tree_sha_8: Type.Optional(
    Type.String({ description: "8-character tree SHA prefix (for next-cycle action)" }),
  ),
  tree_sha: Type.Optional(Type.String({ description: "Full 40-char tree SHA (for run-id action)" })),
  cycle: Type.Optional(Type.Number({ description: "Cycle number (for run-id action)" })),
});

export const identityTool: ToolDefinition<typeof IdentityParams> = {
  name: "sortie-identity",
  label: "Sortie Identity",
  description:
    "Compute Sortie run identity values: tree SHA from a git repo, next cycle number for a tree SHA, or format a run ID.",
  parameters: IdentityParams,
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    try {
      switch (params.action) {
        case "tree-sha": {
          if (!params.repo_path) {
            return {
              content: [{ type: "text" as const, text: "Error: repo_path parameter is required for tree-sha action" }],
              details: {},
            };
          }
          const sha = getTreeSha(params.repo_path);
          return {
            content: [{ type: "text", text: sha }],
            details: {},
          };
        }

        case "next-cycle": {
          if (!params.deposition_dir) {
            return {
              content: [{ type: "text" as const, text: "Error: deposition_dir parameter is required for next-cycle action" }],
              details: {},
            };
          }
          if (!params.tree_sha_8) {
            return {
              content: [{ type: "text" as const, text: "Error: tree_sha_8 parameter is required for next-cycle action" }],
              details: {},
            };
          }
          const cycle = nextCycle(params.deposition_dir, params.tree_sha_8);
          return {
            content: [{ type: "text", text: String(cycle) }],
            details: {},
          };
        }

        case "run-id": {
          if (!params.tree_sha) {
            return {
              content: [{ type: "text" as const, text: "Error: tree_sha parameter is required for run-id action" }],
              details: {},
            };
          }
          if (params.cycle == null) {
            return {
              content: [{ type: "text" as const, text: "Error: cycle parameter is required for run-id action" }],
              details: {},
            };
          }
          const id = runId(params.tree_sha, params.cycle);
          return {
            content: [{ type: "text", text: id }],
            details: {},
          };
        }

        default: {
          return {
            content: [{ type: "text", text: `Unknown action: ${params.action}` }],
            details: {},
          };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        details: {},
      };
    }
  },
};
