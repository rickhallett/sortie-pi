# Phase 8 Parity Check: TypeScript vs Python Oracle

**Date:** 2026-03-30
**Protocol:** SORTIE_PROTOCOL_v3.md (source of truth)
**TypeScript:** `/Users/mrkai/code/sortie-pi`
**Python oracle:** `/Users/mrkai/code/sortie-proto/sortie`

Per the implementation plan: "If the TypeScript and Python implementations disagree
on a behavioral question, consult sortie_protocol_v3.md. The protocol is the source
of truth. If the Python implementation diverges from the protocol, it is the Python
that is wrong."

---

## 1. Run ID Format

| Aspect | Protocol | TypeScript | Python | Status |
|--------|----------|-----------|--------|--------|
| Format | `{tree_sha_8}-{cycle}` | `{tree_sha_8}-{cycle}` | `{tree_sha}-{cycle}` (full 40-char) | **Python diverges** |
| tree_sha source | `git write-tree` | `git write-tree` | `git write-tree` | Match |
| Cycle counting | scan `{sha8}-*` dirs | scan `{sha8}-*` dirs | scan `{full_sha}-*` dirs | Python diverges |

**Verdict:** TypeScript is correct per Protocol Section 6.2. Python uses the full SHA which creates unnecessarily long directory names and run IDs. This is a **Python divergence**, not a TS bug.

---

## 2. Triage Logic

| Aspect | Protocol | TypeScript | Python | Status |
|--------|----------|-----------|--------|--------|
| Exit 0 | merge (no findings) | merge, exit 0 | merge, exit 0 | Match |
| Exit 1 | block (convergent + severity in block_on) | block, exit 1 | block, exit 1 | Match |
| Exit 2 | merge_with_findings | merge_with_findings, exit 2 | merge_with_findings, exit 2 | Match |
| Convergence check | only convergent can block | `convergence === "convergent"` | `finding.get("convergent")` | Match (field name differs) |
| Severity gate | severity in block_on | `blockOnSet.has(severity)` | `severity in block_on` | Match |
| All-clear warning | zero findings warning | present | present | Match |

**Verdict:** Triage logic is protocol-equivalent across both implementations.

---

## 3. Attestation Format

| Field | Protocol | TypeScript | Python | Status |
|-------|----------|-----------|--------|--------|
| step | required | string | string | Match |
| tree_sha | required | string | string | Match |
| cycle | required | number | int | Match |
| verdict | required | VerdictValue | string | Match |
| findings_count | required | number | int | Match |
| tokens | required | `number \| Record` | int | TS superset |
| wall_time_ms | required | number | int | Match |
| timestamp | required | ISO 8601 string | ISO 8601 string | Match |

**Verdict:** Match. TS `tokens` field accepts both `number` and `Record<string, number>`, which is a compatible superset.

---

## 4. Verdict Format

| Field | Protocol | TypeScript | Python | Status |
|-------|----------|-----------|--------|--------|
| verdict | MUST | VerdictValue | string | Match |
| convergence | MUST | VerdictConvergence | not present | **Python missing** |
| findings | MUST | Finding[] | list[dict] | Match |
| tree_sha | MUST | string | string | Match |
| cycle | MUST | number | not present | **Python missing** |
| run_id | MUST | string | not present | **Python missing** |
| branch | MUST | string | `worker_branch` | Name divergence |
| mode | MUST | string | not present | **Python missing** |
| error | SHOULD | `string \| null` | not present | **Python missing** |
| debrief_model | optional | string | not present | TS richer |
| roster | optional | string[] | not present | TS richer |

**Verdict:** TypeScript verdict is protocol-complete. Python verdict is missing several MUST fields (`convergence`, `cycle`, `run_id`, `mode`). Python also uses `worker_branch` instead of `branch`.

---

## 5. Ledger Entry Format

| Field | Protocol | TypeScript | Python | Status |
|-------|----------|-----------|--------|--------|
| run_id | MUST | string | not explicit | Python derives on read |
| tree_sha | MUST | string | string | Match |
| cycle | MUST | number | int | Match |
| timestamp | MUST | ISO 8601 | ISO 8601 | Match |
| project | MUST | string | not present | **Python missing** |
| branch | MUST | string | `worker_branch` | Name divergence |
| mode | MUST | string | not present | **Python missing** |
| verdict | MUST | VerdictValue | string | Match |
| findings | MUST | Finding[] | list[dict] | Match |
| Summary fields | SHOULD | all present | not present | TS richer |

**Verdict:** TypeScript ledger is protocol-complete with computed summary fields. Python ledger is minimal.

---

## 6. Finding Structure

| Field | Protocol | TypeScript | Python | Status |
|-------|----------|-----------|--------|--------|
| id | MUST | string | string | Match |
| severity | MUST | Severity enum | string | Match |
| file | MUST | string | string | Match |
| line | MUST | number | int | Match |
| category | MUST | string | string | Match |
| summary | MUST | string | string | Match |
| detail | MUST | string | string | Match |
| convergence | debrief only | `"convergent" \| "divergent"` | boolean-like | Representation differs |
| sources | debrief only | string[] | list[str] | Match |
| disposition | optional | Disposition enum | string | Match |

**Verdict:** Match on all required fields. Convergence representation differs (TS uses string enum, Python uses a boolean-like field) but semantics are equivalent.

---

## 7. Config Format

| Aspect | TypeScript | Python | Status |
|--------|-----------|--------|--------|
| Invocation model | `provider` (anthropic/google/openai) | `invoke` (hook-agent/cli) + `command` | **Intentional divergence** |
| Timeout units | milliseconds | seconds | Divergence (not interoperable) |
| Prompt field name | `prompt_template` | `prompt` | Naming divergence |
| Mode trigger | not present | `trigger: merge\|milestone` | TS omits (not in protocol) |
| Top-level project | present | not present | TS adds |
| Deposition dir | `deposition_dir: .sortie` | `deposition.dir: .sortie/{tree_sha}-{cycle}/` | Config shape differs |

**Verdict:** Config formats are intentionally different. TS uses native Pi SDK provider model; Python uses subprocess/CLI invocation. These are architectural choices, not parity issues. The protocol does not mandate a config format.

---

## 8. Deposition Layout

| Artifact | TypeScript | Python | Status |
|----------|-----------|--------|--------|
| Run directory | `.sortie/{sha8}-{cycle}/` | `.sortie/{full_sha}-{cycle}/` | Python diverges from protocol |
| Reviewer output | `sortie-{name}.yaml` | `sortie-{name}.yaml` | Match |
| Verdict | `verdict.yaml` | `verdict.yaml` | Match |
| Attestation dir | `attestations/` | `attestations/` | Match |
| Attestation file | `{step}.yaml` | `{step}.yaml` | Match |
| Ledger | `.sortie/ledger.yaml` | `.sortie/ledger.yaml` | Match |

**Verdict:** Layout matches except for directory naming (full SHA vs 8-char prefix).

---

## 9. Fail-Secure Behavior

| Scenario | Protocol | TypeScript | Python | Status |
|----------|----------|-----------|--------|--------|
| All reviewers error | error verdict, exit 1 | error verdict, exit 1 | error verdict, exit 1 | Match |
| Debrief fails | deterministic fallback | `aggregateFallback()` | fallback aggregation | Match |
| Infrastructure failure | must not silently pass | EmptyDiffError → exit 0; other errors → exit 1 | similar | Match |

**Verdict:** Fail-secure semantics match across both implementations.

---

## Summary

### Protocol Compliance

| Area | TypeScript | Python |
|------|-----------|--------|
| Run ID format | Compliant (`{sha8}-{cycle}`) | **Non-compliant** (full SHA) |
| Verdict fields | Complete (all MUST fields) | **Incomplete** (missing convergence, cycle, run_id, mode) |
| Ledger fields | Complete with summaries | Minimal |
| Triage logic | Correct | Correct |
| Attestation format | Correct | Correct |
| Fail-secure | Correct | Correct |
| Finding structure | Correct | Correct |

### Conclusion

The TypeScript implementation is the more protocol-complete of the two. The Python oracle diverges from the protocol in two notable ways:

1. **Run ID uses full SHA** instead of the protocol-specified 8-char prefix
2. **Verdict missing MUST fields** (convergence, cycle, run_id, mode)

Per the implementation plan: these are Python divergences, not TypeScript bugs. The protocol is the source of truth, and the TypeScript implementation follows it correctly.

The two implementations are **not artifact-interoperable** (different run ID formats mean different directory names), but they are **behaviorally equivalent** on the core protocol semantics: triage decisions, exit codes, fail-secure behavior, finding structure, and attestation format.
