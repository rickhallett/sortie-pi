import { Type, type Static } from "@sinclair/typebox";
import { stringify } from "yaml";
import { Ledger } from "../contracts/ledger.js";
import type { Disposition } from "../contracts/types.js";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

const LedgerParams = Type.Object({
  action: Type.Union(
    [
      Type.Literal("find"),
      Type.Literal("branch"),
      Type.Literal("dispose"),
      Type.Literal("bulk-dispose"),
    ],
    { description: "Ledger action to perform" },
  ),
  ledger_path: Type.String({ description: "Path to the ledger YAML file" }),
  tree_sha: Type.Optional(Type.String({ description: "Full 40-char tree SHA" })),
  cycle: Type.Optional(Type.Number({ description: "Cycle number" })),
  branch: Type.Optional(Type.String({ description: "Branch name to query" })),
  finding_id: Type.Optional(Type.String({ description: "Finding ID for disposition update" })),
  disposition: Type.Optional(
    Type.String({ description: "Disposition value: fixed, false-positive, deferred, or disagree" }),
  ),
});

export const ledgerTool: ToolDefinition<typeof LedgerParams> = {
  name: "sortie-ledger",
  label: "Sortie Ledger",
  description:
    "Query and update the Sortie run ledger. Supports finding runs by identity, querying by branch, and updating finding dispositions.",
  parameters: LedgerParams,
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    try {
      if (!params.ledger_path) {
        return {
          content: [{ type: "text" as const, text: "Error: ledger_path parameter is required" }],
          details: {},
        };
      }

      const ledger = new Ledger(params.ledger_path);

      switch (params.action) {
        case "find": {
          if (!params.tree_sha) {
            return {
              content: [{ type: "text" as const, text: "Error: tree_sha parameter is required for find action" }],
              details: {},
            };
          }
          if (params.cycle == null) {
            return {
              content: [{ type: "text" as const, text: "Error: cycle parameter is required for find action" }],
              details: {},
            };
          }
          const run = ledger.findRun(params.tree_sha, params.cycle);
          if (!run) {
            return {
              content: [{ type: "text", text: "Run not found" }],
              details: {},
            };
          }
          return {
            content: [{ type: "text", text: stringify(run) }],
            details: {},
          };
        }

        case "branch": {
          if (!params.branch) {
            return {
              content: [{ type: "text" as const, text: "Error: branch parameter is required for branch action" }],
              details: {},
            };
          }
          const runs = ledger.runsForBranch(params.branch);
          return {
            content: [{ type: "text", text: stringify(runs) }],
            details: {},
          };
        }

        case "dispose": {
          if (!params.tree_sha) {
            return {
              content: [{ type: "text" as const, text: "Error: tree_sha parameter is required for dispose action" }],
              details: {},
            };
          }
          if (params.cycle == null) {
            return {
              content: [{ type: "text" as const, text: "Error: cycle parameter is required for dispose action" }],
              details: {},
            };
          }
          if (!params.finding_id) {
            return {
              content: [{ type: "text" as const, text: "Error: finding_id parameter is required for dispose action" }],
              details: {},
            };
          }
          if (!params.disposition) {
            return {
              content: [{ type: "text" as const, text: "Error: disposition parameter is required for dispose action" }],
              details: {},
            };
          }
          ledger.updateDisposition(
            params.tree_sha,
            params.cycle,
            params.finding_id,
            params.disposition as Disposition,
          );
          return {
            content: [{ type: "text", text: `Updated disposition for finding ${params.finding_id} to ${params.disposition}` }],
            details: {},
          };
        }

        case "bulk-dispose": {
          if (!params.tree_sha) {
            return {
              content: [{ type: "text" as const, text: "Error: tree_sha parameter is required for bulk-dispose action" }],
              details: {},
            };
          }
          if (params.cycle == null) {
            return {
              content: [{ type: "text" as const, text: "Error: cycle parameter is required for bulk-dispose action" }],
              details: {},
            };
          }
          if (!params.disposition) {
            return {
              content: [{ type: "text" as const, text: "Error: disposition parameter is required for bulk-dispose action" }],
              details: {},
            };
          }
          ledger.bulkDispose(
            params.tree_sha,
            params.cycle,
            params.disposition as Disposition,
          );
          return {
            content: [{ type: "text", text: `Updated all findings in run ${params.tree_sha.slice(0, 8)}-${params.cycle} to ${params.disposition}` }],
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
