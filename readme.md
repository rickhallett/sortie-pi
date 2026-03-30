# Sortie

Validation subsystem for agentic software delivery. Sortie evaluates proposed code changes at merge boundaries by running parallel LLM-based reviews, synthesizing results via convergence analysis, applying deterministic triage rules, and emitting durable audit artifacts.

## How It Works

1. **Parallel review** -- Multiple LLM reviewers inspect the diff independently, producing structured findings with severity ratings.
2. **Debrief synthesis** -- A debrief model consolidates reviewer outputs, identifying convergent findings (flagged by multiple reviewers) vs. divergent ones.
3. **Deterministic triage** -- Policy-driven merge gating: only convergent findings at blocking severities can block a merge. Divergent findings are always advisory.
4. **Artifact deposition** -- Every run produces reviewer outputs, a consolidated verdict, per-step attestations, and an append-only ledger entry.

## Key Properties

- **Content-keyed runs** -- Runs are keyed to `git write-tree` SHA, not branch names. Same content = same identity.
- **Convergence-gated blocking** -- A single reviewer cannot block a merge. Only findings corroborated by multiple reviewers can gate.
- **Fail-secure** -- If all reviewers error, the merge is blocked. Infrastructure failure never silently passes.
- **Read-only reviewers** -- Reviewers cannot mutate the repository. Enforced via Pi SDK `beforeToolCall` hooks.
- **Full audit trail** -- Verdicts, attestations, and ledger entries provide complete traceability from finding to merge decision.

## Tech Stack

| Component | Choice |
|-----------|--------|
| Language | TypeScript (ES2022, NodeNext) |
| Runtime | Bun + [Pi SDK](https://github.com/nichochar/pi-sdk) (`@mariozechner/pi-coding-agent` v0.64.0) |
| Tests | Bun native (`bun test`) |
| Package manager | Bun |
| Schema validation | TypeBox (`@sinclair/typebox`) |
| Config/artifacts | YAML |

## Getting Started

```bash
bun install
bun tsc --noEmit    # type-check
bun test            # run tests
bun run build       # compile
```

## Current Status

All 22 implementation tasks across Phases 0--8 are complete. **738 tests pass across 48 test files.**

- Protocol contracts for identity, triage, ledger, attestations, fallback debrief, and verdict artifacts
- Harness modules for config loading, prompt assembly, session creation, reviewer invocation, domain locking, event capture, and conversation logging
- Native Pi custom tools for triage, ledger, and identity operations
- Validation pipeline orchestration in `src/validation/pipeline.ts`
- Operator CLI commands: `validate`, `status`, `dispose`, `dispose-bulk`
- Prompt templates in `prompts/` and Pi agent definitions in `.pi/agents/`
- 3 adversarial reviews conducted and addressed (see `docs/reviews/`)
- Parity check against Python oracle completed (see `docs/parity-check.md`)
- One open backlog item: VULN-003 (domain lock wiring blocked by Pi SDK constraint, see `backlog.yml`)

## Architecture

```
src/
  contracts/     # Protocol domain logic (zero runtime deps)
  harness/       # Pi SDK integration and runtime guards
  tools/         # Native Pi customTool registrations
  test-support/  # Shared fixture loaders for tests
  validation/    # Pipeline orchestration
  cli/           # Operator entry points
```

The implemented dependency direction is **contracts** -> **harness** -> **tools** -> **validation** -> **cli**.

See `docs/architecture.md` for the current architecture map and `claude.md` for contributor guidance.

## Protocol

The Sortie Protocol v3 specification is in `sortie_protocol_v3.md`. It defines:

- Review orchestration and reviewer/debrief contracts
- Merge-gating semantics (convergence filtering + severity policy)
- Artifact schemas (verdict, attestation, ledger)
- Failure handling and fail-secure behavior
- Exit codes: `0` (merge), `1` (block/error), `2` (merge with findings)

## Run Artifacts

Each validation run produces a deposition at `.sortie/{tree_sha_8}-{cycle}/`:

```
.sortie/a1b2c3d4-1/
  sortie-claude.yaml              # reviewer output
  sortie-gemini.yaml              # reviewer output
  verdict.yaml                    # consolidated verdict
  attestations/
    sortie-claude.yaml            # reviewer attestation
    sortie-gemini.yaml            # reviewer attestation
    debrief.yaml                  # debrief attestation
```

The append-only ledger at `.sortie/ledger.yaml` tracks all runs with full findings and summary fields for querying.

## Dispositions

After review, findings can be annotated: `fixed`, `false-positive`, `deferred`, `disagree`. Dispositions are tracked in both the verdict and ledger without altering original findings.

## License

Apache-2.0.
