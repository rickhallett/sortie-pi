import { Type, type Static } from "@sinclair/typebox";
import { parse, stringify } from "yaml";
import { triageVerdict } from "../contracts/triage.js";
import type { Finding, Severity } from "../contracts/types.js";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

const TriageParams = Type.Object({
  findings_yaml: Type.String({ description: "YAML-encoded array of Finding objects" }),
  block_on: Type.Array(Type.String({ description: "Severity level to block on" }), {
    description: "Severity levels that should block merge (e.g. critical, major)",
  }),
});

export const triageTool: ToolDefinition<typeof TriageParams> = {
  name: "sortie-triage",
  label: "Sortie Triage",
  description:
    "Evaluate code review findings against triage configuration and return a merge-gating decision. Parses findings from YAML and returns the triage verdict as YAML.",
  parameters: TriageParams,
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    try {
      if (!params.block_on || !Array.isArray(params.block_on)) {
        return {
          content: [{ type: "text" as const, text: "Error: block_on parameter is required and must be an array of severity levels" }],
          details: {},
        };
      }

      const parsed = parse(params.findings_yaml);
      if (parsed != null && !Array.isArray(parsed)) {
        return {
          content: [{ type: "text" as const, text: "Error: findings_yaml must be a YAML-encoded array of Finding objects" }],
          details: {},
        };
      }
      const findings: Finding[] = parsed ?? [];
      const blockOn = params.block_on as Severity[];

      const result = triageVerdict(findings, { block_on: blockOn });

      return {
        content: [{ type: "text", text: stringify(result) }],
        details: {},
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        details: {},
      };
    }
  },
};
