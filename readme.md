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

### Run Validation

```bash
node dist/cli/index.js validate --config harness.yaml --branch <branch> [--mode code]
```

### Check Status

```bash
node dist/cli/index.js status --ledger .sortie/ledger.yaml
```

### Update Finding Dispositions

```bash
node dist/cli/index.js dispose --ledger .sortie/ledger.yaml --run-id <id> --finding <fid> --disposition fixed
node dist/cli/index.js dispose-bulk --ledger .sortie/ledger.yaml --run-id <id> --disposition deferred
```

## Architecture

```
src/
  contracts/     # Protocol domain logic (zero runtime deps)
  harness/       # Pi SDK integration (session factory is sole SDK seam)
  validation/    # Full validation lifecycle pipeline
  tools/         # Pi customTool registrations
  cli/           # Operator entry points
```

Three layers with strict dependency direction: **contracts** (pure logic) -> **harness** (Pi SDK) -> **validation** (pipeline orchestration).

See `claude.md` for detailed module descriptions.

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
