# Architecture

## Current Implementation Status

All 22 implementation tasks across Phases 0--8 are complete. The system is fully implemented: protocol contracts, harness/runtime support, native custom tools, end-to-end validation pipeline, and operator-facing CLI commands. Prompt templates and Pi agent definitions are also present as repository assets.

**Test suite:** 738 tests, 0 failures, 48 test files.

**Adversarial reviews conducted:**
- Phase 5 -- Gemini adversarial security review (`docs/reviews/gemini/2026-03-30-phase5-adversarial-gemini.md`)
- Phase 6 -- Gemini adversarial review (`docs/reviews/gemini/2026-03-30-2006-phase6-gemini.md`)
- Phase 7+8 -- Claude adversarial review (`docs/reviews/claude/2026-03-30-phase7-phase8-adversarial-claude.md`)

All issues raised in adversarial reviews have been addressed except VULN-003 (see `backlog.yml`).

**Parity check:** Behavioral equivalence verified against the Python oracle implementation (`docs/parity-check.md`).

## Implemented Modules

### `src/contracts/`

Pure protocol-aligned logic with no Pi SDK imports:

- `identity.ts`: tree SHA extraction, run IDs, run directories, and cycle allocation
- `triage.ts`: deterministic merge gating from finding convergence and severity
- `ledger.ts`: append-only YAML ledger with summary recomputation and disposition updates
- `attestation.ts`: per-step attestation read, write, and verification helpers
- `debrief.ts`: deterministic fallback aggregation when the debrief model fails
- `verdict.ts`: verdict artifact read, write, and disposition updates
- `types.ts`: shared protocol types used across contracts, harness, and tools

### `src/harness/`

Runtime-facing modules and the only Pi SDK seam:

- `config.ts`: `harness.yaml` loading and structural validation
- `session-factory.ts`: model resolution plus reviewer/lead session configuration and creation
- `invoker.ts`: reviewer prompt execution, output parsing, timeout handling, and fan-out orchestration
- `domain-lock.ts`: write-path enforcement for locked sessions, including workspace containment checks and a hard bash block
- `prompt.ts`: reviewer and debrief prompt assembly plus template loading
- `conversation-log.ts`: per-reviewer transcript capture with filename sanitization
- `events.ts`: in-memory run event collection and summary aggregation
- `prompt-assets.test.ts`: structural tests for prompt template files

### `src/tools/`

Native Pi custom tools that expose contract functions to lead sessions:

- `triage-tool.ts`: YAML-in/YAML-out triage wrapper
- `ledger-tool.ts`: run lookup plus single and bulk disposition updates
- `identity-tool.ts`: tree SHA, next-cycle, and run-id helpers with path validation for repo access
- `index.ts`: consolidated `sortieCustomTools` export

### `src/test-support/`

Shared helpers and structural tests:

- `load-fixture.ts`: YAML fixture loader rooted at `fixtures/`
- `agent-definitions.test.ts`: structural validation of `.pi/agents/` definitions

### `src/validation/`

- `pipeline.ts`: full validation lifecycle orchestration
- `pipeline.test.ts`: protocol-level pipeline wiring coverage

### `src/cli/`

- `validate.ts`: config loading plus validation execution
- `status.ts`: ledger status output
- `dispose.ts`: single and bulk disposition commands (`dispose` and `dispose-bulk`)
- `index.ts`: argv parsing and command dispatch
- `smoke.test.ts`: end-to-end CLI smoke tests via subprocess execution

### `prompts/`

Repository prompt assets used by `harness.yaml`:

- `sortie-code.md`
- `sortie-tests.md`
- `sortie-docs.md`
- `debrief.md`

### `.pi/agents/`

Static Pi agent definitions for orchestration, lead synthesis, and reviewer roles.

## Dependency Direction

The currently implemented code follows this direction:

`contracts` -> `harness` -> `tools` -> `validation` -> `cli`

- `contracts` stays runtime-agnostic
- `harness` owns Pi SDK interaction and runtime safety controls
- `tools` adapt contract operations into Pi custom tools
- `validation` composes the runtime review lifecycle
- `cli` exposes operator-facing entry points

## Runtime Boundaries

- Reviewer sessions are intended to run with read-only tools only.
- Domain-locked sessions enforce allowed write paths relative to a workspace root.
- Bash is blocked in domain-locked sessions because shell commands can bypass file-path restrictions.
- Lead-session custom tools are the intended write path for `.sortie` artifacts.

## Open Backlog

- **VULN-003:** Wire domain lock into pipeline-level tool enforcement. The `createDomainLock()` function is built and tested but the returned checker is not wired into live sessions due to Pi SDK lacking a public `beforeToolCall` hook. See `backlog.yml` for details.

## Documentation Contract

When the repository surface changes:

- Update this file first for architectural truth
- Keep `readme.md` aligned for top-level workflow and status claims
- Keep `claude.md` aligned for contributor-facing implementation guidance
