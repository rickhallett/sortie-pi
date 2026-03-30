# Architecture

## Current Implementation Status

Sortie is currently implemented as protocol contracts, harness/runtime support, and native custom tools. The end-to-end validation pipeline and CLI surfaces are scaffolded in the repository, but they are not implemented yet.

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

### `src/tools/`

Native Pi custom tools that expose contract functions to lead sessions:

- `triage-tool.ts`: YAML-in/YAML-out triage wrapper
- `ledger-tool.ts`: run lookup plus single and bulk disposition updates
- `identity-tool.ts`: tree SHA, next-cycle, and run-id helpers with path validation for repo access
- `index.ts`: consolidated `sortieCustomTools` export

### `src/test-support/`

Shared helpers for fixture-backed tests:

- `load-fixture.ts`: YAML fixture loader rooted at `fixtures/`

## Scaffolded, Not Yet Implemented

### `src/validation/`

Reserved for pipeline orchestration modules that will connect diff acquisition, reviewer execution, debrief synthesis, triage, artifact writing, and exit handling.

### `src/cli/`

Reserved for operator-facing commands such as `validate`, `status`, and disposition workflows.

## Dependency Direction

The currently implemented code follows this direction:

`contracts` -> `harness` -> `tools`

- `contracts` stays runtime-agnostic
- `harness` owns Pi SDK interaction and runtime safety controls
- `tools` adapt contract operations into Pi custom tools

The future validation pipeline should depend on these layers rather than bypassing them.

## Runtime Boundaries

- Reviewer sessions are intended to run with read-only tools only.
- Domain-locked sessions enforce allowed write paths relative to a workspace root.
- Bash is blocked in domain-locked sessions because shell commands can bypass file-path restrictions.
- Lead-session custom tools are the intended write path for `.sortie` artifacts.

## Documentation Contract

When the repository surface changes:

- Update this file first for architectural truth
- Keep `readme.md` aligned for top-level workflow and status claims
- Keep `claude.md` aligned for contributor-facing implementation guidance
