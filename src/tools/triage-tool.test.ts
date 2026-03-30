import { describe, test, expect } from "bun:test";
import { parse, stringify } from "yaml";
import { triageTool } from "./triage-tool.js";
import type { Finding } from "../contracts/types.js";

/** Extract text from the first content block of a tool result. */
function textOf(result: { content: { type: string; text?: string }[] }): string {
  const block = result.content[0];
  if (block.type !== "text" || typeof block.text !== "string") {
    throw new Error("Expected text content block");
  }
  return block.text;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = {} as any;

describe("sortie-triage tool", () => {
  test("has correct name, label, and description", () => {
    expect(triageTool.name).toBe("sortie-triage");
    expect(triageTool.label).toBe("Sortie Triage");
    expect(typeof triageTool.description).toBe("string");
    expect(triageTool.description.length).toBeGreaterThan(0);
  });

  test("returns block for convergent critical findings when block_on includes critical", async () => {
    const findings: Finding[] = [
      {
        id: "F001",
        severity: "critical",
        file: "main.ts",
        line: 10,
        category: "security",
        summary: "SQL injection vulnerability",
        detail: "User input not sanitized",
        convergence: "convergent",
      },
    ];
    const findingsYaml = stringify(findings);

    const result = await triageTool.execute(
      "call-1",
      { findings_yaml: findingsYaml, block_on: ["critical"] },
      undefined,
      undefined,
      ctx,
    );

    const parsed = parse(textOf(result));
    expect(parsed.action).toBe("block");
    expect(parsed.exit_code).toBe(1);
    expect(parsed.blocking_findings).toHaveLength(1);
    expect(parsed.blocking_findings[0].id).toBe("F001");
  });

  test("returns merge for empty findings", async () => {
    const findingsYaml = stringify([]);

    const result = await triageTool.execute(
      "call-2",
      { findings_yaml: findingsYaml, block_on: ["critical", "major"] },
      undefined,
      undefined,
      ctx,
    );

    const parsed = parse(textOf(result));
    expect(parsed.action).toBe("merge");
    expect(parsed.exit_code).toBe(0);
    expect(parsed.blocking_findings).toHaveLength(0);
    expect(parsed.advisory_findings).toHaveLength(0);
    expect(parsed.all_clear_warning).toBeTruthy();
  });

  test("returns merge_with_findings for divergent findings even if severity is in block_on", async () => {
    const findings: Finding[] = [
      {
        id: "F002",
        severity: "critical",
        file: "auth.ts",
        line: 20,
        category: "security",
        summary: "Weak hash",
        detail: "MD5 used for passwords",
        convergence: "divergent",
      },
    ];
    const findingsYaml = stringify(findings);

    const result = await triageTool.execute(
      "call-3",
      { findings_yaml: findingsYaml, block_on: ["critical"] },
      undefined,
      undefined,
      ctx,
    );

    const parsed = parse(textOf(result));
    expect(parsed.action).toBe("merge_with_findings");
    expect(parsed.exit_code).toBe(2);
    expect(parsed.blocking_findings).toHaveLength(0);
    expect(parsed.advisory_findings).toHaveLength(1);
  });

  test("returns merge_with_findings for convergent findings whose severity is NOT in block_on", async () => {
    const findings: Finding[] = [
      {
        id: "F003",
        severity: "minor",
        file: "utils.ts",
        line: 5,
        category: "style",
        summary: "Unused variable",
        detail: "Variable x is declared but never used",
        convergence: "convergent",
      },
    ];
    const findingsYaml = stringify(findings);

    const result = await triageTool.execute(
      "call-4",
      { findings_yaml: findingsYaml, block_on: ["critical", "major"] },
      undefined,
      undefined,
      ctx,
    );

    const parsed = parse(textOf(result));
    expect(parsed.action).toBe("merge_with_findings");
    expect(parsed.exit_code).toBe(2);
    expect(parsed.blocking_findings).toHaveLength(0);
    expect(parsed.advisory_findings).toHaveLength(1);
  });

  test("output is valid YAML", async () => {
    const findingsYaml = stringify([]);

    const result = await triageTool.execute(
      "call-5",
      { findings_yaml: findingsYaml, block_on: [] },
      undefined,
      undefined,
      ctx,
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    // Should not throw
    const parsed = parse(textOf(result));
    expect(parsed).toBeDefined();
  });

  describe("malformed input handling", () => {
    test("returns error message for malformed YAML in findings_yaml", async () => {
      const result = await triageTool.execute(
        "call-err-1",
        { findings_yaml: "{{not: valid: yaml: [}", block_on: ["critical"] },
        undefined,
        undefined,
        ctx,
      );

      const text = textOf(result);
      expect(text).toMatch(/^Error: /);
    });

    test("returns error message when findings_yaml parses to non-array", async () => {
      const result = await triageTool.execute(
        "call-err-2",
        { findings_yaml: "not_an_array: true", block_on: ["critical"] },
        undefined,
        undefined,
        ctx,
      );

      const text = textOf(result);
      expect(text).toMatch(/^Error: /);
    });

    test("returns error message when block_on is missing/undefined", async () => {
      const result = await triageTool.execute(
        "call-err-3",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { findings_yaml: stringify([]) } as any,
        undefined,
        undefined,
        ctx,
      );

      const text = textOf(result);
      expect(text).toMatch(/^Error: /);
    });
  });
});
