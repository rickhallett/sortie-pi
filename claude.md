# claude.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sortie is a validation subsystem for agentic software delivery. It evaluates proposed code changes at merge boundaries by running parallel LLM-based reviews, synthesizing results, applying deterministic triage rules, and emitting durable audit artifacts.

This repo is a **fresh TypeScript implementation** of the Sortie Protocol v3 (`sortie_protocol_v3.md`), built on the Pi SDK (`@mariozechner/pi-coding-agent` v0.64.0). The implementation plan is in `pi_native_implementation_plan_v3.md`.

## Source of Truth

- **`sortie_protocol_v3.md`** is the authoritative specification. All behavioral questions defer to it.
- Legacy Python implementations are parity oracles only — consulted for behavioral equivalence, never preserved as runtime or used to dictate architecture.

## Tech Stack

- **Language:** TypeScript (ES2022, NodeNext modules)
- **Runtime:** Bun + Pi SDK (`@mariozechner/pi-coding-agent`)
- **Test runner:** Bun native (`bun test`)
- **Package manager:** Bun (no npm/pnpm)
- **Schema validation:** `@sinclair/typebox`
- **Config/artifact format:** YAML (`yaml` package)

## Build & Test Commands

```bash
bun install
bun tsc --noEmit              # type-check
bun test                       # run all tests
bun test <file>                # run a single test file
bun test --grep "test name"   # run a specific test by name
bun run build                  # compile to dist/
```

## Development Rules

- **Bun only.** No npm, pnpm, or yarn. No Vitest or Jest. Bun is the runtime, package manager, and test runner.
- **Strict red-green TDD.** Always write the failing test first, then the implementation to make it pass. No exceptions. The developer runs `bun test --watch` in a live terminal as the primary code health indicator.
- **Markdown filenames stay lowercase.** Any repository `.md` file must use a lowercase filename (excepting CLAUDE.md / README.md)

## Architecture

Current dependency direction:

```
contracts -> harness -> tools -> orchestrator
                                      |
                                validation (pipeline.ts — CI path)
                                      |
                                     cli
```

### `src/contracts/` — Protocol-aligned domain logic (zero Pi SDK imports)
- `types.ts` — Shared protocol types (Finding, ReviewerOutput, Verdict, TriageResult, etc.)
- `identity.ts` — Run identity: tree SHA via `git write-tree`, cycle numbering, run IDs (`{sha8}-{cycle}`)
- `triage.ts` — Deterministic merge-gating: convergence filtering, severity gating, exit codes (0/1/2)
- `ledger.ts` — Append-only YAML ledger with query/disposition operations
- `attestation.ts` — Per-step attestation read/write/verify
- `debrief.ts` — Debrief fallback aggregation (deterministic, no model calls)
- `verdict.ts` — Verdict schema read/write

### `src/harness/` — Pi SDK runtime integration (the only layer that touches Pi)
- `config.ts` — `harness.yaml` loader and validation
- `session-factory.ts` — Pi session creation, model resolution (sole Pi SDK seam)
- `invoker.ts` — Reviewer session lifecycle, parallel invocation
- `domain-lock.ts` — `beforeToolCall` write restriction with workspace containment checks; bash is blocked in locked sessions
- `prompt.ts` — Template assembly with `{branch}`, `{diff}`, `{sortie_outputs}` substitution
- `conversation-log.ts` — Session transcript capture with reviewer-name sanitization for log filenames
- `events.ts` — Runtime event emission and aggregation
- `prompt-assets.test.ts` — Structural tests for prompt template files

### `src/tools/` — Pi `customTool` registrations
- `triage-tool.ts` — YAML-in/YAML-out wrapper around contract triage
- `ledger-tool.ts` — Run lookup and disposition updates backed by the ledger contract
- `identity-tool.ts` — Tree SHA, next-cycle, and run-id helpers with basic path validation
- `index.ts` — Heterogeneous tool export for lead sessions

### `src/test-support/` — Shared helpers and structural tests
- `load-fixture.ts` — Reads YAML fixtures from `fixtures/`
- `agent-definitions.test.ts` — Structural validation of `.pi/agents/` definitions

### `src/validation/` — Validation pipeline
- `pipeline.ts` — Full protocol step orchestration
- `pipeline.test.ts` — Lifecycle wiring coverage with session-factory mocks

### `src/cli/` — Operator entry points
- `validate.ts` — Config loading plus pipeline execution
- `status.ts` — Ledger status output
- `dispose.ts` — Single and bulk disposition commands (`dispose` and `dispose-bulk`)
- `index.ts` — CLI argv parsing and dispatch
- `smoke.test.ts` — End-to-end CLI smoke tests via subprocess execution

### `src/orchestrator/` — Multi-agent delegation framework
- `registry.ts` — parse `.pi/agents/*.md` definitions, build sortie lookup from config
- `delegate-tool.ts` — the `delegate` Pi custom tool: spawns child agent sessions, captures results
- `progress.ts` — compact progress line emission via `sendCustomMessage`
- `bootstrap.ts` — load config, build registry, create orchestrator session with tools
- `index.ts` — public API exports

### `prompts/` — Prompt assets
- `sortie-code.md`, `sortie-tests.md`, `sortie-docs.md` — Reviewer prompts referenced by `harness.yaml`
- `debrief.md` — Debrief synthesis prompt referenced by `harness.yaml`

### `.pi/agents/` — Pi agent definitions
- Orchestrator, validation lead, and reviewer role definitions used as static protocol guidance

## Key Design Principles

- **Contracts are runtime-agnostic.** `src/contracts/` must never import Pi SDK.
- **Session factory is the single Pi SDK seam.** API changes require surgery in one file only.
- **Fixtures before runtime.** Golden test data in `fixtures/` anchors protocol behavior before any LLM sessions. All contract tests must use these fixtures.
- **Tools are native.** `customTools` call TypeScript contract modules directly — no subprocesses, no Python.
- **Domain locking via `beforeToolCall`.** Reviewers are read-only; locked sessions enforce workspace containment and reject bash entirely.
- **Fail-secure.** Total reviewer failure = error verdict = merge blocked (exit 1). Infrastructure failure must never silently produce a passing result.

## Protocol Concepts (quick reference)

- **Run ID:** `{tree_sha_8}-{cycle}` — content-keyed, not branch-keyed
- **Verdicts:** `pass | pass_with_findings | fail | error`
- **Triage actions:** `merge` (exit 0) | `block` (exit 1) | `merge_with_findings` (exit 2)
- **Convergence:** Only convergent findings (flagged by >= 2 reviewers) can block merge. Divergent findings are always advisory.
- **Deposition path:** `.sortie/{run_id}/` containing reviewer artifacts, `verdict.yaml`, and `attestations/`
- **Ledger:** Append-only YAML at `.sortie/ledger.yaml` with full findings + summary fields

## Artifact Layout

```
.sortie/{run_id}/
  sortie-{reviewer_name}.yaml   # per-reviewer output
  verdict.yaml                   # consolidated verdict
  attestations/
    sortie-{reviewer_name}.yaml  # per-reviewer attestation
    debrief.yaml                 # debrief attestation
```

## Architecture Docs

- `docs/architecture.md` is the canonical snapshot of the implemented repository architecture and current delivery status.
- `readme.md` should stay aligned with `docs/architecture.md` for any top-level structure or workflow claims.

## Agents

- **`.claude/agents/adversarial-security.md`**: Adversarial security review agent to proactively identify and report exploitable vulnerabilities.
- **`.claude/agents/full-spectrum-review.md`**: Full spectrum code review agent to identify bugs, performance bottlenecks, and architectural issues.
- **`.claude/agents/adversarial-process.md`**: Adversarial process review agent to audit git history, commit discipline, and TDD adherence.
- **`.claude/agents/docs-architect.md`**: Documentation architect agent specializing in repository-wide documentation sync and maintaining architecture documents.
