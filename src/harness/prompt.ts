// Prompt assembly — SORTIE_PROTOCOL_v3.md Sections 7.3, 8.2

import { readFile } from "node:fs/promises";

function quoteMarkdownLiteral(value: string): string {
  const backtickRuns = value.match(/`+/g) ?? [];
  const longestRun = backtickRuns.reduce(
    (max, run) => Math.max(max, run.length),
    0,
  );
  const fence = "`".repeat(longestRun + 1);
  const paddedValue =
    value.startsWith("`") || value.endsWith("`") ? ` ${value} ` : value;

  return `${fence}${paddedValue}${fence}`;
}

/**
 * Assemble the prompt sent to each reviewer.
 *
 * Per Section 7.3:
 *  1. Substitute {branch} in the template.
 *  2. Append separator \n---\n.
 *  3. Append the diff wrapped in a code fence.
 */
export function assembleReviewerPrompt(
  template: string,
  diff: string,
  branch: string,
): string {
  const body = template.replaceAll("{branch}", quoteMarkdownLiteral(branch));
  return `${body}\n---\n\`\`\`diff\n${diff}\n\`\`\``;
}

/**
 * Assemble the prompt sent to the debrief model.
 *
 * Per Section 8.2, substitute:
 *  - {n}              — number of reviewers invoked
 *  - {tree_sha}       — full 40-character tree SHA
 *  - {branch}         — worker branch name
 *  - {sortie_outputs} — concatenated reviewer outputs joined with \n\n
 */
export function assembleDebriefPrompt(
  template: string,
  reviewerOutputs: string[],
  treeSha: string,
  branch: string,
  n: number,
): string {
  return template
    .replaceAll("{n}", String(n))
    .replaceAll("{tree_sha}", quoteMarkdownLiteral(treeSha))
    .replaceAll("{branch}", quoteMarkdownLiteral(branch))
    .replaceAll("{sortie_outputs}", reviewerOutputs.join("\n\n"));
}

/**
 * Load a prompt template from disk.
 *
 * Separated from assembly for testability — assembly functions accept
 * the template string directly so they can be tested without I/O.
 */
export async function loadTemplate(path: string): Promise<string> {
  return await readFile(path, "utf-8");
}
