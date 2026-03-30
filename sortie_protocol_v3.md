# Sortie Protocol Specification

**Version:** 3.0
**Date:** 2026-03-30
**Status:** Draft

---

# 1. Requirements Language

The key words `MUST`, `MUST NOT`, `REQUIRED`, `SHOULD`, `SHOULD NOT`, and `MAY` in this document are to be interpreted as normative requirements.

---

# 2. Purpose and Scope

Sortie is a validation subsystem for agentic software delivery.

Sortie evaluates a proposed change at a merge boundary by:

1. collecting parallel review outputs from multiple reviewers,
2. synthesizing those outputs into a single verdict,
3. triaging findings according to explicit merge-gating rules,
4. emitting durable artifacts for audit, remediation, and evaluation.

Sortie exists to make validation legible, measurable, and operationally trustworthy.

## 2.1 Concerns

Sortie is concerned with:

- review orchestration,
- reviewer and debrief contracts,
- merge-gating semantics,
- artifact generation,
- cost and observability capture,
- failure handling under partial or complete reviewer failure.

## 2.2 Non-Goals

Sortie is not concerned with:

- how engineering work is performed before validation begins,
- how code is edited or patched,
- how a particular runtime implements sessions or tools,
- UI presentation details,
- guaranteeing bug-free output.

This protocol does not define:

- patch generation workflows,
- engineering task decomposition,
- a specific runtime API,
- a specific command-line interface,
- a specific repository layout beyond the validation artifact contracts,
- any requirement to reuse prior implementation code.

---

# 3. Core Model

Sortie operates on a **review target**, defined as a specific repository content state plus validation context.

A review target MUST include:

- a repository snapshot identifier,
- a worker branch or equivalent source identifier,
- a validation mode,
- a diff or equivalent description of the proposed change,
- access to the repository state being reviewed.

Sortie produces a **run**, which is the unit of validation, deposition, attestation, and ledger capture.

Each run MUST produce:

- individual reviewer outputs,
- a consolidated verdict,
- per-step attestations,
- a ledger entry,
- enough metadata to reconstruct what was reviewed and how the verdict was reached.

---

# 4. Actors

## 4.1 Worker

The Worker produces the change under review.

The Worker MUST NOT be treated as an authoritative source for validation outcomes.

## 4.2 Validation Lead

The Validation Lead orchestrates validation for a run.

The Validation Lead MUST:

- create or resume the run context,
- dispatch reviewers,
- invoke debrief synthesis,
- apply triage rules,
- emit verdict and artifacts,
- fail secure when validation cannot be trusted.

## 4.3 Reviewer

A Reviewer inspects the review target and emits findings.

A Reviewer MUST be treated as an evidence generator, not as the final decision-maker.

## 4.4 Debrief

The Debrief synthesizes reviewer outputs into a single verdict.

The Debrief MUST:

- map related findings across reviewers,
- assign convergence labels,
- emit a consolidated verdict artifact,
- preserve traceability from consolidated findings back to reviewer-originated findings.

## 4.5 Triage

Triage applies deterministic merge-gating rules to the debrief verdict.

Triage MUST be policy-driven and reproducible. Triage MUST NOT invoke a model.

## 4.6 Pre-Merge Hook

The Pre-Merge Hook verifies that a passing verdict exists before merge.

The Pre-Merge Hook is read-only. It checks artifacts; it does not create them.

## 4.7 Operator

An Operator MAY inspect artifacts, dispositions, costs, and validation history to make operational decisions.

---

# 5. Review Modes

Sortie MUST support named validation modes.

A mode MUST be able to define:

- applicable reviewers (roster subset),
- review instructions (prompt template),
- debrief instructions,
- triage configuration (MAY override top-level triage; replacement, not merge),
- trigger expectations.

Sortie MAY define standard modes such as `code`, `tests`, `docs`. Mode names are configuration data, not protocol constants.

---

# 6. Repository Identity and Run Identity

## 6.1 Repository Content Identity (Tree SHA)

Each run MUST be keyed to repository content, not merely to a branch name.

For Git-based repositories, the content identity MUST be the `git write-tree` SHA of the reviewed state.

The canonical `tree_sha` MUST be the full 40-character lowercase hexadecimal hash.

Display layers and run IDs MAY abbreviate the hash, but the canonical identity stored in verdicts, attestations, and ledger entries MUST preserve the full 40-character value.

Two worktrees with identical file content MUST produce the same tree SHA.

## 6.2 Cycle

A run MUST include a remediation cycle number.

Cycle numbering MUST begin at `1`.

If a run is repeated for the same content identity, the cycle MUST increment monotonically. The next cycle MUST be `max(existing cycles for this tree SHA) + 1`.

If repository content changes and therefore the content identity changes, the new content identity MUST begin again at cycle `1`.

## 6.3 Run ID

The canonical run identifier MUST have the format:

```text
{tree_sha_8}-{cycle}
```

Where `tree_sha_8` is the first 8 characters of the tree SHA and `cycle` is a positive integer.

The run ID is a display-friendly key. The authoritative identity of a run is the `(tree_sha, cycle)` tuple.

## 6.4 Deposition Path

The canonical deposition path MUST be:

```text
{deposition_dir}/{tree_sha_8}-{cycle}/
```

Where `deposition_dir` is configurable (default: `.sortie`).

After a successful run, the deposition directory MUST contain:

```text
{run_id}/
  sortie-{reviewer_name}.yaml   # one per reviewer
  verdict.yaml                   # consolidated verdict
  attestations/
    sortie-{reviewer_name}.yaml  # one per reviewer
    debrief.yaml                 # debrief attestation
```

## 6.5 Remediation Cycles

When a reviewer blocks a merge and the developer fixes the code, the tree SHA changes. A new run with a new tree SHA and cycle 1 begins. If the developer re-stages without changing content (same tree SHA), the cycle increments.

---

# 7. Reviewer Contract

## 7.1 Permissions

Reviewers MUST be read-only with respect to the repository under review.

Reviewers MUST NOT be permitted to mutate source files, validation artifacts, or repository state.

If a runtime exposes tools, reviewers MAY use read-only inspection tools (file read, grep, find, ls).

## 7.2 Responsibilities

Reviewers MUST:

- inspect the proposed change in repository context,
- produce structured findings,
- avoid conversational wrap-up outside the required output schema.

Reviewers SHOULD:

- read full files relevant to changed code,
- inspect callers and related tests,
- inspect nearby interfaces or contracts,
- verify documentation claims against code when applicable to the selected mode.

## 7.3 Input

Each reviewer MUST receive an assembled prompt consisting of:

1. A prompt template with `{branch}` substituted.
2. A separator: `\n---\n`.
3. The diff wrapped in a code fence: `` ```diff\n{diff}\n``` ``.

## 7.4 Output

Each reviewer MUST produce structured output containing:

```yaml
model: string                    # MUST — model identifier
verdict: pass | pass_with_findings | fail | error   # MUST
findings:                        # MUST — list (MAY be empty)
  - id: string                   # unique within the run (e.g., "F001")
    severity: critical | major | minor
    file: string                 # path relative to repository root
    line: integer                # line number in the diff
    category: string             # defect classification (e.g., "security", "correctness")
    summary: string              # one-line, under 100 characters
    detail: string               # detailed explanation
tokens: object | null            # SHOULD — {input, output, total} or {total}
wall_time_ms: integer | null     # SHOULD — wall-clock duration in milliseconds
error: string | null             # MUST — error message if invocation failed, else null
```

Reviewer findings MUST NOT include convergence labels. Convergence is assigned at debrief time.

Reviewer outputs SHOULD preserve raw model output for auditability, but raw transcript storage is an implementation detail.

## 7.5 Verdict Rules

A reviewer's verdict MUST be:

- `"fail"` if any finding has severity `"critical"`.
- `"pass_with_findings"` if findings exist but none are critical.
- `"pass"` if the findings list is empty.
- `"error"` if the reviewer encountered a fatal invocation error.

## 7.6 Parallel Execution

All reviewers MUST be invoked in parallel. Wall time MUST be measured independently per reviewer.

---

# 8. Debrief Contract

## 8.1 Purpose

Debrief converts multiple reviewer outputs into a single verdict artifact.

## 8.2 Input

The debrief model receives a prompt assembled from a template with these substitutions:

| Variable | Value |
|----------|-------|
| `{n}` | Number of reviewers invoked |
| `{tree_sha}` | Full 40-character tree SHA |
| `{branch}` | Worker branch name |
| `{sortie_outputs}` | Concatenated reviewer outputs, each prefixed with `### {model_name}` |

## 8.3 Convergence Scoring

The debrief MUST identify when multiple reviewers describe the same underlying issue:

- **Convergent:** Finding meets or exceeds the configured convergence threshold (default: 2). High confidence.
- **Divergent:** Finding does not meet the threshold. Logged, never blocks.

The default threshold SHOULD be `2`.

## 8.4 Severity Assignment

For convergent findings, the final severity MUST be the maximum severity reported by any source reviewer. For divergent findings, the severity is the single reviewer's reported severity.

## 8.5 Output

The debrief MUST produce a verdict artifact containing:

```yaml
tree_sha: string                 # MUST — full 40-character SHA
cycle: integer                   # MUST
run_id: string                   # MUST
branch: string                   # MUST
mode: string                     # MUST
verdict: pass | pass_with_findings | fail | error   # MUST
convergence: convergent | divergent | mixed | none   # MUST
findings:                        # MUST — unified list
  - id: string
    severity: critical | major | minor
    convergence: convergent | divergent
    sources: [string, ...]       # reviewer model names
    file: string
    line: integer | null
    category: string
    summary: string
    detail: string | null
    disposition: null             # initially null; set after human review
error: string | null             # MUST
diff_stats: object | null        # SHOULD
```

The `convergence` field on the verdict MUST be:
- `"convergent"` if any convergent finding exists and no divergent findings exist.
- `"divergent"` if only divergent findings exist.
- `"mixed"` if both convergent and divergent findings exist.
- `"none"` if no findings exist.

The verdict artifact MAY also include: `debrief_model`, `roster`, `tokens`, `wall_time_ms`.

## 8.6 Fallback

If debrief invocation fails, the system MUST apply a deterministic fallback:

- Aggregate findings from successful reviewer outputs.
- Set convergence to `"divergent"` (cannot determine convergence with incomplete synthesis).
- Proceed to triage normally.
- Log a warning.

Fallback MUST NOT silently convert infrastructure failure into a passing result. Fallback MUST NOT block solely because debrief failed.

---

# 9. Triage and Merge-Gating Semantics

## 9.1 Configuration

Triage is configured with:

- `block_on`: list of severity strings that trigger blocking (e.g., `["critical", "major"]`).
- `convergence_threshold`: minimum reviewers for convergence (default: 2). Currently informational.
- `max_remediation_cycles`: maximum cycles before escalation (default: 2). Currently informational.

## 9.2 Blocking Rule

Only `convergent` findings MAY block merge.

`divergent` findings MUST be advisory regardless of severity.

## 9.3 Severity Policy

If any convergent finding has severity included in `block_on`, the run outcome MUST be `block`.

## 9.4 Decision Logic

Triage MUST apply these rules in order:

1. **Convergence filter.** Only convergent findings MAY block. Divergent findings are always advisory.
2. **Severity filter.** A convergent finding blocks only if its severity is in `block_on`.
3. **Action determination:**
   - Any convergent blocking finding exists: `action = "block"`, `exit_code = 1`.
   - Findings exist but none block: `action = "merge_with_findings"`, `exit_code = 2`.
   - No findings: `action = "merge"`, `exit_code = 0`.

## 9.5 Triage Result

```yaml
action: merge | merge_with_findings | block    # MUST
exit_code: 0 | 1 | 2                           # MUST
blocking_findings: [...]                        # convergent findings in block_on severity
advisory_findings: [...]                        # all other findings
all_clear_warning: string | null                # SHOULD — warn if zero findings (rubber-stamp risk)
```

## 9.6 Clean Pass

If no findings exist, the run outcome MUST be `merge`. Implementations SHOULD emit an all-clear warning to discourage rubber-stamping.

## 9.7 Error

If validation trust cannot be established, the run outcome MUST be `error`.

`error` MUST be treated as non-mergeable (exit code 1) unless an operator explicitly overrides policy outside the protocol.

---

# 10. Validation Lifecycle

The Validation Lead MUST execute these steps in order:

1. **Diff.** Compute a three-dot diff (`base...branch`). If the diff is empty, exit with code 0.

2. **Identity.** Compute the tree SHA and next cycle number (Section 6).

3. **Create run directory.** Create `{deposition_dir}/{run_id}/attestations/`.

4. **Resolve configuration.** Load the review mode. Determine which reviewers to invoke and which triage rules to apply.

5. **Invoke reviewers.** Invoke all roster reviewers in parallel. Each reviewer receives the assembled prompt (Section 7.3). Each produces a reviewer output (Section 7.4). Write per-reviewer artifacts and attestations.

6. **Debrief.** Invoke the debrief model with all reviewer outputs (Section 8.2). If debrief fails, use fallback aggregation (Section 8.6). Write debrief attestation.

7. **Fail-secure check.** If the verdict is `"error"`, print an error and exit with code 1 immediately. Merge MUST NOT proceed.

8. **Write verdict.** Write `verdict.yaml` to the run directory (Section 8.5).

9. **Triage.** Evaluate the verdict against triage configuration (Section 9). Determine the merge action and exit code.

10. **Ledger.** Append a complete run entry to the ledger (Section 12).

11. **Exit.** Return the triage exit code: 0 (merge), 1 (block), or 2 (merge with findings).

---

# 11. Failure Semantics and Fail-Secure Behavior

## 11.1 Reviewer Failure

A reviewer timeout, authentication failure, runtime error, transport error, or schema violation MUST be represented as reviewer `verdict: error`.

## 11.2 Partial Reviewer Failure

If some reviewers error but others succeed:

- Aggregate findings from successful reviewers.
- Set convergence to `"divergent"` (cannot determine convergence with incomplete data).
- Proceed to triage normally.
- Artifacts MUST preserve which reviewers failed.

## 11.3 Total Reviewer Failure

If ALL reviewers produce errors (or if there are no results):

- Set verdict to `"error"`.
- Block the merge (exit code 1).
- Print: `"Pipeline failed: all reviewers errored -- blocking merge (fail-secure)"`.

The system MUST NOT silently pass the change.

## 11.4 Debrief Failure

If debrief invocation fails:

- Apply fallback aggregation (Section 8.6).
- Log a warning.
- Do NOT block solely because debrief failed.

## 11.5 Artifact Durability Under Failure

Even when the run outcome is `error`, the system SHOULD persist enough artifacts to support diagnosis.

---

# 12. Artifact Model

## 12.1 Attestations

Each validation step MUST emit a step attestation.

The canonical attestation path MUST be:

```text
{run_dir}/attestations/{step}.yaml
```

Attestations MUST be written immediately after each step completes.

Minimum attestation schema:

```yaml
step: string                     # MUST
tree_sha: string                 # MUST
cycle: integer                   # MUST
verdict: string                  # MUST
findings_count: integer          # MUST
tokens: integer | object         # MUST
wall_time_ms: integer            # MUST
timestamp: string                # MUST — ISO 8601 UTC
```

## 12.2 Ledger

The ledger is an append-only YAML file with structure `{ runs: [...] }`.

### Entry Schema

Each run entry MUST include:

```yaml
run_id: string                   # MUST
tree_sha: string                 # MUST — full 40-character SHA
cycle: integer                   # MUST
timestamp: string                # MUST — ISO 8601 UTC
project: string                  # MUST — repository name
branch: string                   # MUST
worker_branch: string            # MUST — alternate branch field (for querying)
mode: string                     # MUST
verdict: string                  # MUST
convergence: string              # MUST
debrief_model: string            # MUST
roster_used: [string, ...]       # MUST
model_status:                    # MUST — per-model
  model_name:
    verdict: string
    error: string | null
    findings_count: integer
    wall_time_ms: integer
    tokens: object
findings:                        # MUST — complete findings with convergence
  - { ... }
diff_stats:                      # SHOULD
  files: integer
  insertions: integer
  deletions: integer
  raw: string
wall_time_ms: integer            # MUST — total pipeline duration
tokens:                          # MUST
  by_model: { ... }
  total: integer
```

### Summary Fields

Each ledger entry SHOULD also include summary fields for efficient querying:

```yaml
findings_total: integer
findings_convergent: integer
findings_divergent: integer
by_severity: { critical: N, major: N, minor: N }
dispositions: { fixed: N, false-positive: N, deferred: N, disagree: N }
```

### Operations

The ledger MUST support:

- `append(entry)`: add a run and immediately persist the full ledger to disk.
- `findRun(tree_sha, cycle)`: retrieve by identity.
- `runsForBranch(branch)`: query by branch.
- `updateDisposition(tree_sha, cycle, finding_id, disposition)`: update one finding.
- `bulkDispose(tree_sha, cycle, disposition)`: update all findings in a run.

All mutations MUST immediately persist. Mutations MUST preserve append-only run history. Updates annotate existing records rather than deleting historical runs.

Missing ledger file MUST be treated as empty `{ runs: [] }`.

---

# 13. Dispositions

Consolidated findings MAY be annotated after remediation.

Supported dispositions:

- `fixed`
- `false-positive`
- `deferred`
- `disagree`

Disposition updates MUST preserve the original finding content.

---

# 14. Trust Boundaries and Permissions

## 14.1 Pre-Merge Hook

The Pre-Merge Hook MUST verify:

1. The deposition directory exists.
2. A run directory for the current tree SHA exists.
3. The `verdict.yaml` file exists and parses.
4. If `verdict.yaml` contains a `tree_sha` field, it MUST match the current tree SHA exactly.
5. The `attestations/` directory exists and is non-empty.
6. The verdict is `"pass"` or `"pass_with_findings"`.

If any check fails, the hook MUST block the merge (exit code 2).

## 14.2 Validation Lead

The Validation Lead MAY write validation artifacts and protocol-defined state.

The Validation Lead SHOULD NOT have unrestricted write authority over product code unless explicitly required by the enclosing harness.

## 14.3 Reviewers

Reviewers MUST be read-only. The enforcement mechanism is implementation-dependent (tool restrictions, filesystem permissions, or worktree isolation).

## 14.4 Tooling

If tools are available, tool permissions MUST be explicitly bounded.

Claims of isolation MUST match the actual enforcement mechanism. Tool-level blocking MUST NOT be described as filesystem isolation unless true filesystem isolation exists.

## 14.5 Secret Handling

Validation artifacts MUST NOT intentionally persist secrets unless the enclosing system explicitly defines that behavior and its controls.

---

# 15. Observability

## 15.1 Token Tracking

The system SHOULD track token consumption per reviewer, per debrief, and as a pipeline total. Token breakdowns SHOULD include input, output, cache read, cache write where available.

## 15.2 Cost Tracking

The system SHOULD track dollar cost per session where the underlying runtime provides cost data.

## 15.3 Wall Time

The system MUST track wall time per reviewer, per debrief, and as a pipeline total.

## 15.4 Extended Observability

Implementations SHOULD also capture:

- tool call audit trails,
- streaming or event traces for debugging,
- diff statistics,
- convergence statistics.

---

# 16. Configuration Semantics

## 16.1 Required Capabilities

A valid Sortie configuration MUST define: roster, debrief strategy, triage policy, validation modes, ledger location, deposition location.

## 16.2 Roster

Each roster entry MUST specify a `name` (unique identifier) and an invocation method. Additional fields (provider, model, tools, timeout, prompt) are implementation-dependent.

## 16.3 Modes

A mode specifies a prompt template and MAY override the roster subset and triage rules. Mode-level triage overrides top-level triage (replacement, not merge).

## 16.4 Deposition

The deposition template defines where run directories are created. It MAY contain `{tree_sha}` and `{cycle}` placeholders.

## 16.5 Optional Configuration

A configuration system MAY also define: cost limits, timeout budgets, per-mode reviewer counts, tool permissions, runtime-specific model selection, optional teams outside validation.

Configuration keys and file formats are implementation details. The protocol defines the semantics, not the syntax.

---

# 17. Compliance Criteria

An implementation is Sortie-protocol compliant if it:

1. creates content-keyed runs with deterministic cycle numbering,
2. executes reviewer, debrief, and triage phases with the semantics defined above,
3. blocks only on convergent findings whose severities are policy-blocking,
4. fails secure on validation trust failure,
5. emits deposition, verdict, attestation, and ledger artifacts in the defined contracts,
6. preserves operational observability and post-run disposition tracking,
7. enforces read-only reviewer permissions,
8. returns the specified exit codes (0 = merge, 1 = block/error, 2 = merge with findings).

---
