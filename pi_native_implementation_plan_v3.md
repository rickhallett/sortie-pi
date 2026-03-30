# Pi-Native Sortie Implementation Plan v3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `sortie_protocol_v3.md` in a fresh TypeScript codebase on Pi SDK.

**Assumptions:**
- `sortie_protocol_v3.md` is the specification. It is the source of truth.
- The existing Python sortie codebase is a parity oracle only -- consulted to verify behavioral equivalence, not preserved as a runtime.
- Pi SDK v0.64.0 contract is verified (see `pi-sdk-probe-notes.md`).

**Runtime:** `@mariozechner/pi-coding-agent` v0.64.0
**Language:** TypeScript (ES2022, NodeNext modules)
**Test runner:** Vitest
**Package manager:** npm

---

## Planning Rules

1. The protocol document is authoritative.
2. Legacy implementations MAY be used as parity oracles during development.
3. Legacy module boundaries, CLI shapes, file layouts, and subprocess patterns MUST NOT be preserved by default.
4. Native Pi abstractions SHOULD be preferred over compatibility shims.
5. Python or other legacy code MUST NOT remain the control plane.

---

## Repository Structure

```
src/
  contracts/             # Protocol-aligned domain types and deterministic rules
    types.ts             # Shared protocol types (Finding, ReviewerOutput, etc.)
    identity.ts          # Run identity: tree SHA, cycles, run IDs
    triage.ts            # Triage engine: convergence filtering, severity gating
    ledger.ts            # Append-only YAML ledger
    attestation.ts       # Per-step attestation read/write/verify
    debrief.ts           # Debrief fallback aggregation (deterministic)
    verdict.ts           # Verdict schema types + read/write

  harness/               # Pi SDK runtime integration
    config.ts            # harness.yaml loader + validation
    session-factory.ts   # Pi session creation, model resolution, auth wiring
    invoker.ts           # Reviewer session lifecycle (createAgentSession)
    domain-lock.ts       # beforeToolCall write restriction
    prompt.ts            # Prompt template assembly
    conversation-log.ts  # Session transcript capture
    events.ts            # Runtime event emission + aggregation

  validation/            # Validation team workflow
    pipeline.ts          # Full lifecycle steps 1-11
    artifacts.ts         # Deposition directory management + artifact writing
    outcomes.ts          # Run outcome formatting + reporting

  tools/                 # Pi customTool registrations
    triage-tool.ts       # sortie-triage (calls contracts/triage natively)
    ledger-tool.ts       # sortie-ledger (calls contracts/ledger natively)
    identity-tool.ts     # sortie-identity (calls contracts/identity natively)
    index.ts             # Tool registry export

  cli/                   # Operator entry points
    validate.ts          # validate subcommand
    status.ts            # status subcommand
    dispose.ts           # dispose + dispose-bulk subcommands
    index.ts             # CLI router

.pi/agents/              # Pi agent definitions
  orchestrator.md
  validation-lead.md
  reviewer-claude.md
  reviewer-gemini.md
  reviewer-codex.md

fixtures/                # Golden test data (Phase 2)
  reviewer-outputs/
  debrief-inputs/
  verdicts/
  triage-outcomes/
  attestations/
  ledger-entries/
  failure-scenarios/

prompts/                 # Review prompt templates
harness.yaml             # Multi-team config
.sortie/                 # Runtime artifacts (gitignored except ledger)
```

---

## Dependency Graph

```
Phase 0 (bootstrap):
  └─ Task 1:  Project scaffold

Phase 1 (contracts -- parallel, zero runtime deps):
  ┌─ Task 2:  Protocol types
  └─ Task 3:  Prompt assembly

Phase 2 (fixtures -- depends on Task 2):
  └─ Task 4:  Golden fixture suite

Phase 3 (contract modules -- parallel, depend on Tasks 2 + 4):
  ┌─ Task 5:  Identity module
  ├─ Task 6:  Triage module
  ├─ Task 7:  Ledger module
  └─ Task 8:  Attestation module

Phase 4 (synthesis -- depends on Phase 3):
  ┌─ Task 9:  Debrief module ──────── depends on: types, triage
  ├─ Task 10: Verdict module ──────── depends on: types, triage
  └─ Task 11: Harness config loader ─ depends on: types

Phase 5 (harness kernel -- depends on Phase 4):
  ┌─ Task 12: Session factory ─────── depends on: config
  ├─ Task 13: Reviewer invoker ────── depends on: session-factory, prompt, identity
  ├─ Task 14: Domain locking ──────── depends on: config
  ├─ Task 15: Conversation logging ── depends on: session-factory
  ├─ Task 16: Event capture ───────── depends on: types
  └─ Task 17: Custom tools ────────── depends on: triage, ledger, identity

Phase 6 (validation team -- depends on all above):
  └─ Task 18: Validation pipeline ─── depends on: everything

Phase 7 (surface -- parallel, depends on Task 18):
  ┌─ Task 19: CLI entry point
  ├─ Task 20: Agent definitions
  └─ Task 21: Prompt updates

Phase 8 (end-to-end -- depends on all above):
  └─ Task 22: End-to-end validation + parity check
```

**9 phases. 22 tasks.**

---

## Phase 0: Bootstrap

### Task 1: Project scaffold

- [ ] Create `package.json` with dependencies: `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`, `@sinclair/typebox`, `minimatch`, `yaml`. Dev: `typescript`, `@types/node`, `vitest`.
- [ ] Create `tsconfig.json` (ES2022, NodeNext, strict, `src/` root, `dist/` out).
- [ ] Create `vitest.config.ts`.
- [ ] Create directory structure: `src/contracts/`, `src/harness/`, `src/validation/`, `src/tools/`, `src/cli/`, `fixtures/`.
- [ ] `npm install` and verify `npx tsc --noEmit` succeeds on empty project.
- [ ] Commit: `"chore: scaffold Pi-native sortie project"`

---

## Phase 1: Protocol Types and Prompt Assembly

### Task 2: Protocol types

Shared types referenced by all modules. No logic, just interfaces.

**Specification reference:** sortie_protocol_v3.md Sections 7, 8, 9, 12.

**File:** `src/contracts/types.ts`

- [ ] Define:

```typescript
export type Severity = "critical" | "major" | "minor";
export type Convergence = "convergent" | "divergent";
export type VerdictConvergence = "convergent" | "divergent" | "mixed" | "none";
export type VerdictValue = "pass" | "pass_with_findings" | "fail" | "error";
export type Disposition = "fixed" | "false-positive" | "deferred" | "disagree";
export type TriageAction = "merge" | "merge_with_findings" | "block";

export interface Finding {
  id: string;
  severity: Severity;
  file: string;
  line: number;
  category: string;
  summary: string;
  detail: string;
  convergence?: Convergence;
  sources?: string[];
  disposition?: Disposition | null;
}

export interface ReviewerOutput {
  model: string;
  verdict: VerdictValue;
  findings: Finding[];
  tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
  cost?: number;
  wall_time_ms?: number;
  raw_output?: string;
  error?: string | null;
}

export interface Verdict {
  verdict: VerdictValue;
  convergence: VerdictConvergence;
  findings: Finding[];
  tree_sha: string;
  cycle: number;
  run_id: string;
  branch: string;
  mode: string;
  diff_stats?: Record<string, unknown>;
  debrief_model?: string;
  roster?: string[];
  tokens?: Record<string, unknown>;
  wall_time_ms?: number;
  error?: string | null;
}

export interface TriageResult {
  action: TriageAction;
  exit_code: 0 | 1 | 2;
  blocking_findings: Finding[];
  advisory_findings: Finding[];
  all_clear_warning?: string | null;
}

export interface TriageConfig {
  block_on: Severity[];
  convergence_threshold?: number;
  max_remediation_cycles?: number;
}

export interface Attestation {
  step: string;
  tree_sha: string;
  cycle: number;
  verdict: VerdictValue;
  findings_count: number;
  tokens: number | Record<string, number>;
  wall_time_ms: number;
  timestamp: string;
}

export interface LedgerEntry {
  run_id: string;
  tree_sha: string;
  cycle: number;
  timestamp: string;
  project: string;
  branch: string;
  worker_branch: string;
  mode: string;
  verdict: VerdictValue;
  convergence: string;
  debrief_model: string;
  roster_used: string[];
  model_status: Record<string, {
    verdict: VerdictValue;
    error?: string | null;
    findings_count: number;
    wall_time_ms: number;
    tokens: Record<string, number>;
  }>;
  findings: Finding[];
  diff_stats: { files?: number; insertions?: number; deletions?: number; raw?: string };
  wall_time_ms: number;
  tokens: { by_model: Record<string, Record<string, number>>; total: number };
  // Summary fields for efficient querying
  findings_total: number;
  findings_convergent: number;
  findings_divergent: number;
  by_severity: { critical: number; major: number; minor: number };
  dispositions: Record<Disposition, number>;
}
```

- [ ] No tests needed (pure types). Verify with `npx tsc --noEmit`.
- [ ] Commit: `"feat(contracts): add shared protocol types"`

---

### Task 3: Prompt assembly

**Specification reference:** sortie_protocol_v3.md Sections 7.3, 8.2.

**File:** `src/harness/prompt.ts`, `src/harness/prompt.test.ts`

- [ ] Implement `assembleReviewerPrompt(templatePath, diff, branch)`:
  1. Read template from disk.
  2. Substitute `{branch}`.
  3. Append separator `\n---\n` and diff in `` ```diff `` fence.
- [ ] Implement `assembleDebriefPrompt(templatePath, results, treeSha, branch)`:
  1. Read template from disk.
  2. Substitute `{n}`, `{tree_sha}`, `{branch}`, `{sortie_outputs}`.
- [ ] Tests: template substitution, diff fencing, debrief block formatting.
- [ ] Commit: `"feat(harness): add prompt assembly module"`

---

## Phase 2: Golden Fixtures

### Task 4: Golden fixture suite

Create a fixture set that anchors protocol behavior before runtime code is introduced. All contract module tests (Phase 3+) MUST use these fixtures.

**File:** `fixtures/` directory tree

- [ ] Create `fixtures/reviewer-outputs/`:
  - `pass-clean.yaml` — zero findings, verdict pass.
  - `pass-with-findings.yaml` — 2 minor findings.
  - `fail-critical.yaml` — 1 critical finding.
  - `error-timeout.yaml` — error verdict, error message.
- [ ] Create `fixtures/debrief-inputs/`:
  - `two-agree.yaml` — two reviewers flag same issue (convergent).
  - `two-disagree.yaml` — two reviewers flag different issues (divergent).
  - `mixed.yaml` — one convergent + one divergent finding.
  - `all-error.yaml` — all reviewers errored.
  - `partial-error.yaml` — one error, one success.
- [ ] Create `fixtures/verdicts/`:
  - `pass.yaml`, `pass-with-findings.yaml`, `fail.yaml`, `error.yaml`.
  - Each with expected field values matching protocol Section 8.5.
- [ ] Create `fixtures/triage-outcomes/`:
  - `merge.yaml` — no findings, exit 0.
  - `merge-with-findings.yaml` — divergent findings only, exit 2.
  - `block-convergent-critical.yaml` — convergent critical, exit 1.
  - `no-block-divergent-critical.yaml` — divergent critical, exit 2.
  - `block-convergent-major.yaml` — convergent major with block_on=["critical","major"], exit 1.
- [ ] Create `fixtures/attestations/`:
  - `reviewer-attestation.yaml`, `debrief-attestation.yaml`.
- [ ] Create `fixtures/ledger-entries/`:
  - `single-run.yaml`, `multi-run.yaml`, `with-dispositions.yaml`.
- [ ] Create `fixtures/failure-scenarios/`:
  - `all-reviewers-error.yaml` — expected error verdict, exit 1.
  - `debrief-fallback.yaml` — debrief fails, fallback aggregation applied.
- [ ] Commit: `"test(fixtures): add golden fixture suite for protocol contracts"`

---

## Phase 3: Contract Modules

Each module implements one section of the protocol. Tests MUST validate against golden fixtures from Phase 2.

---

### Task 5: Identity module

**Specification reference:** sortie_protocol_v3.md Section 6.

**File:** `src/contracts/identity.ts`, `src/contracts/identity.test.ts`

- [ ] Implement `getTreeSha(repoPath)`: exec `git write-tree`, validate 40-hex.
- [ ] Implement `nextCycle(depositionDir, treeSha)`: scan dirs matching `{sha8}-*`, return max+1.
- [ ] Implement `runId(treeSha, cycle)`: format `{sha8}-{cycle}`.
- [ ] Implement `runDir(depositionDir, treeSha, cycle)`: join path.
- [ ] Implement `fullRunIdentity(treeSha, cycle)`: return `{ tree_sha, cycle, run_id, run_dir }`.
- [ ] Tests: format, cycle counting with 0/1/N existing dirs, treeSha validation, 8-char prefix.
- [ ] Commit: `"feat(contracts): add run identity module"`

---

### Task 6: Triage module

**Specification reference:** sortie_protocol_v3.md Section 9.

**File:** `src/contracts/triage.ts`, `src/contracts/triage.test.ts`

- [ ] Implement `triageVerdict(verdict, config)`:
  1. If no findings: return merge, exit 0, allClearWarning.
  2. Partition: convergent + in block_on = blocking; everything else = advisory.
  3. If blocking: action=block, exit 1.
  4. If findings but no blocking: action=merge_with_findings, exit 2.
- [ ] Tests (driven by `fixtures/triage-outcomes/`):
  - Convergent critical blocks when block_on includes critical.
  - Divergent critical never blocks.
  - Empty findings returns merge with all-clear warning.
  - Mixed convergence/severity.
  - Convergent major blocks when block_on includes major.
  - Exit codes: 0, 1, 2.
- [ ] Commit: `"feat(contracts): add triage module"`

---

### Task 7: Ledger module

**Specification reference:** sortie_protocol_v3.md Section 12.2.

**File:** `src/contracts/ledger.ts`, `src/contracts/ledger.test.ts`

- [ ] Implement `Ledger` class with:
  - `load()`: parse YAML, missing file = `{ runs: [] }`.
  - `append(entry)`: add run, compute summary fields, persist atomically.
  - `findRun(treeSha, cycle)`: retrieve by identity.
  - `runsForBranch(branch)`: query by branch.
  - `updateDisposition(treeSha, cycle, findingId, disposition)`: update one finding + recompute summary.
  - `bulkDispose(treeSha, cycle, disposition)`: update all findings in a run.
- [ ] Summary fields computed on append: `findings_total`, `findings_convergent`, `findings_divergent`, `by_severity`, `dispositions`.
- [ ] All writes MUST persist the full ledger atomically.
- [ ] Tests (driven by `fixtures/ledger-entries/`): append + load roundtrip, find, branch query, disposition update, bulk dispose, summary field accuracy.
- [ ] Commit: `"feat(contracts): add ledger module"`

---

### Task 8: Attestation module

**Specification reference:** sortie_protocol_v3.md Section 12.1.

**File:** `src/contracts/attestation.ts`, `src/contracts/attestation.test.ts`

- [ ] Implement `writeAttestation(runPath, attestation)`: write to `{runPath}/attestations/{step}.yaml`.
- [ ] Implement `readAttestation(runPath, step)`: read and parse, return null if missing.
- [ ] Implement `verifyAttestations(runPath, requiredSteps)`: return list of missing steps.
- [ ] Tests (driven by `fixtures/attestations/`): write/read roundtrip, verify with missing steps, empty attestations dir.
- [ ] Commit: `"feat(contracts): add attestation module"`

---

## Phase 4: Synthesis Modules

### Task 9: Debrief module

**Specification reference:** sortie_protocol_v3.md Sections 8, 11.4.

**File:** `src/contracts/debrief.ts`, `src/contracts/debrief.test.ts`

- [ ] Implement `aggregateFallback(results)`:
  - All error: return error verdict (fail-secure).
  - Partial error: merge findings from successful reviewers, convergence=divergent.
  - Compute `VerdictConvergence` field correctly (`"convergent"`, `"divergent"`, `"mixed"`, `"none"`).
- [ ] Tests (driven by `fixtures/debrief-inputs/` and `fixtures/failure-scenarios/`):
  - all-error → error verdict.
  - partial-error → aggregated findings, divergent convergence.
  - no results → error verdict.
  - mixed findings → mixed convergence.
- [ ] Commit: `"feat(contracts): add debrief fallback aggregation"`

---

### Task 10: Verdict module

**Specification reference:** sortie_protocol_v3.md Section 8.5.

**File:** `src/contracts/verdict.ts`, `src/contracts/verdict.test.ts`

- [ ] Implement `writeVerdict(runPath, verdict)`: write `verdict.yaml`.
- [ ] Implement `readVerdict(runPath)`: read and parse.
- [ ] Implement `updateFindingDisposition(runPath, findingId, disposition)`: update in-place.
- [ ] Tests (driven by `fixtures/verdicts/`): write/read roundtrip, disposition update, field completeness.
- [ ] Commit: `"feat(contracts): add verdict module"`

---

### Task 11: Harness config loader

**File:** `src/harness/config.ts`, `src/harness/config.test.ts`

- [ ] Define `HarnessConfig` type: project, orchestrator, teams (each with lead, workers, domain, skills, mental_model, triage).
- [ ] Implement `loadHarnessConfig(path)`: parse YAML, validate required fields, return typed config.
- [ ] Create `harness.yaml` in repo root with validation team configuration.
- [ ] Tests: valid config loads, missing required fields throw, team enumeration.
- [ ] Commit: `"feat(harness): add config loader"`

---

## Phase 5: Harness Kernel

Pi SDK integration. Session lifecycle, domain enforcement, observability.

---

### Task 12: Session factory

**File:** `src/harness/session-factory.ts`, `src/harness/session-factory.test.ts`

- [ ] Implement `createReviewerSession(entry, cwd, auth, options)`:
  1. `getModel(provider, model)`.
  2. `createAgentSession({ cwd, model, tools: createReadOnlyTools(cwd), sessionManager: SessionManager.inMemory(), ... })`.
  3. Return session handle.
- [ ] Implement `createLeadSession(config, cwd, auth, customTools)`: similar but with write-capable tools scoped by domain lock.
- [ ] Implement `disposeSession(session)`: safe teardown.
- [ ] Tests: mock session creation, verify tool configuration.
- [ ] Commit: `"feat(harness): add Pi session factory"`

---

### Task 13: Reviewer invoker

**File:** `src/harness/invoker.ts`, `src/harness/invoker.test.ts`

- [ ] Implement `invokeReviewer(session, prompt, timeout)`:
  1. `session.prompt(assembledPrompt)` with timeout race.
  2. `session.getLastAssistantText()` for output.
  3. `session.getSessionStats()` for tokens + cost.
  4. Parse raw output into `ReviewerOutput` (YAML parse + sanitize).
  5. Return `ReviewerOutput`.
- [ ] Implement `invokeAll(roster, sessions, prompts, timeout)`: `Promise.all()` over roster.
- [ ] Output sanitization: strip markdown fences, collapse blank lines.
- [ ] Tests: mock session, verify output parsing, timeout handling, error capture.
- [ ] Commit: `"feat(harness): add reviewer invoker"`

---

### Task 14: Domain locking

**File:** `src/harness/domain-lock.ts`, `src/harness/domain-lock.test.ts`

- [ ] Implement `createDomainLock(writePatterns)`: returns a `beforeToolCall` hook.
  - Block `write`/`edit` when path doesn't match any pattern.
  - Block `bash` entirely when `writePatterns` is empty (read-only agent).
  - Use `minimatch` for glob matching.
- [ ] Tests: empty patterns block all writes, `.sortie/**` allows sortie writes, specific paths.
- [ ] Commit: `"feat(harness): add domain locking via beforeToolCall"`

---

### Task 15: Conversation logging

**File:** `src/harness/conversation-log.ts`, `src/harness/conversation-log.test.ts`

- [ ] Implement `ConversationLogger`:
  - Capture session transcript (prompts + responses) per reviewer.
  - Write to `{run_dir}/logs/sortie-{reviewer_name}.log`.
  - Configurable: enabled/disabled via harness config.
- [ ] Tests: capture + write roundtrip, disabled = no file written.
- [ ] Commit: `"feat(harness): add conversation logging"`

---

### Task 16: Event capture

**File:** `src/harness/events.ts`, `src/harness/events.test.ts`

- [ ] Implement `RunEventEmitter`:
  - Events: `reviewer:start`, `reviewer:complete`, `reviewer:error`, `debrief:start`, `debrief:complete`, `triage:complete`, `pipeline:complete`.
  - Each event carries: timestamp, step name, duration, token count, cost.
  - Aggregation: `getRunSummary()` returns total tokens, total cost, total wall time, per-model breakdown.
- [ ] Tests: event emission, aggregation accuracy.
- [ ] Commit: `"feat(harness): add runtime event capture"`

---

### Task 17: Custom tools

**File:** `src/tools/triage-tool.ts`, `src/tools/ledger-tool.ts`, `src/tools/identity-tool.ts`, `src/tools/index.ts`

- [ ] Each tool: TypeBox schema (`@sinclair/typebox`), `execute` calls the native contract module directly (no subprocess).
- [ ] `triage-tool`: accepts verdict YAML + block_on, returns triage result.
- [ ] `ledger-tool`: accepts action + params, calls Ledger class methods.
- [ ] `identity-tool`: accepts action, calls identity functions.
- [ ] `index.ts` exports `sortieCustomTools` array for `createAgentSession({ customTools })`.
- [ ] Tests for each tool's execute function.
- [ ] Commit: `"feat(tools): add native Pi custom tools for sortie protocol"`

---

## Phase 6: Validation Team

Wire everything into the full lifecycle from sortie_protocol_v3.md Section 10.

---

### Task 18: Validation pipeline

**File:** `src/validation/pipeline.ts`, `src/validation/pipeline.test.ts`

This is the core. Implements sortie_protocol_v3.md Section 10 steps 1-11.

- [ ] Implement `runValidation(config, branch, mode)`:
  1. Compute diff (exec `git diff`).
  2. `getTreeSha()` + `nextCycle()`.
  3. Create run directory + attestations/.
  4. Resolve mode from config (roster subset, triage overrides).
  5. Assemble prompts per reviewer.
  6. Create sessions via session factory.
  7. `invokeAll()` -- parallel reviewer sessions.
  8. Write per-reviewer artifacts + attestations.
  9. Debrief: invoke debrief model or `aggregateFallback()`.
  10. Fail-secure check: if verdict is error, exit 1.
  11. `writeVerdict()`.
  12. `triageVerdict()`.
  13. Ledger `append()`.
  14. Emit pipeline:complete event.
  15. Return exit code.
- [ ] Tests: mock the invoker and session factory, test the pipeline flow with canned reviewer outputs from fixtures. Verify: correct verdict written, attestations created, ledger appended, exit codes correct for pass/block/error, events emitted.
- [ ] Commit: `"feat(validation): add validation pipeline -- full lifecycle"`

---

## Phase 7: Surface

### Task 19: CLI entry point

**File:** `src/cli/validate.ts`, `src/cli/status.ts`, `src/cli/dispose.ts`, `src/cli/index.ts`

- [ ] Subcommands:
  - `validate --config harness.yaml --branch <branch> [--mode code]`: run validation pipeline.
  - `status --ledger .sortie/ledger.yaml`: show recent runs.
  - `dispose --ledger <path> --run-id <id> --finding <fid> --disposition <d>`: update disposition.
  - `dispose-bulk --ledger <path> --run-id <id> --disposition <d>`: bulk update.
- [ ] Wire to contract modules directly. No subprocess. No Python.
- [ ] Commit: `"feat(cli): add CLI entry point"`

---

### Task 20: Agent definitions

**File:** `.pi/agents/*.md`

- [ ] Create Pi agent definition files:
  - `orchestrator.md` (Opus, delegate-only, zero writes)
  - `validation-lead.md` (Opus, read-only + sortie tools + `.sortie/**` write)
  - `reviewer-claude.md` (Sonnet, read-only)
  - `reviewer-gemini.md` (Gemini, read-only)
  - `reviewer-codex.md` (GPT, read-only)
- [ ] Each with frontmatter: `name`, `description`, `model`, `tools`.
- [ ] System prompts reference the protocol: strict YAML output, severity definitions, verdict rules.
- [ ] Commit: `"feat(agents): add Pi agent definitions"`

---

### Task 21: Prompt updates

**File:** `prompts/sortie-code.md`, `prompts/sortie-tests.md`, `prompts/sortie-docs.md`

- [ ] Add tool usage guidance (reviewers now have read/grep/find/ls).
- [ ] Reinforce: entire output MUST be Sortie YAML schema. No conversational text.
- [ ] Commit: `"docs(prompts): add tool usage guidance"`

---

## Phase 8: End-to-End Validation

### Task 22: End-to-end validation + parity check

- [ ] **Step 1: Build the project.**

```bash
npm run build
```

- [ ] **Step 2: Run TypeScript pipeline on a test branch.**

```bash
node dist/cli/index.js validate --config harness.yaml --branch test/smoke --mode code
```

- [ ] **Step 3: Run Python pipeline on the same branch (parity oracle).**

```bash
uv run python scripts/sortie.py pipeline test/smoke --mode code
```

- [ ] **Step 4: Compare outputs.**

Verify protocol compatibility:
- Same run ID format (`{sha8}-{cycle}`).
- Same deposition layout (`.sortie/{run_id}/`).
- Verdict schema fields match.
- Ledger entry format matches (full findings list + summary fields).
- Attestation files present and correctly structured.
- Triage decision (action + exit code) matches for the same findings.
- Fail-secure behavior: force all reviewers to error and verify both implementations block.

- [ ] **Step 5: Document any divergence.**

If the TypeScript and Python implementations disagree on a behavioral question, consult `sortie_protocol_v3.md`. The protocol is the source of truth. If the Python implementation diverges from the protocol, it is the Python that is wrong.

The parity oracle MUST NOT:
- become the runtime control plane,
- define the new repository structure,
- dictate the new public APIs,
- force subprocess-based architecture into the fresh repo.

- [ ] **Step 6: Commit parity check results.**

```bash
git commit -m "test: end-to-end parity check against Python oracle"
```

---

## Python Disposition

After Task 22 parity checks pass:

- `scripts/*.py` and `tests/test_*.py` are **frozen**. No further modifications.
- `sortie.yaml` is superseded by `harness.yaml`. Retained for reference only.
- `justfile` targets (`sortie-all`, `sortie-status`, etc.) are superseded by CLI subcommands.
- The Python codebase MAY be archived or moved to `archive/` at the maintainer's discretion.

The protocol specification (`sortie_protocol_v3.md`) and the TypeScript implementation are the active codebase going forward.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Reintroducing legacy architecture by accident | Enforce protocol-first review. Reject design choices justified only by legacy file shape. Keep parity checks semantic, not structural. |
| Pi runtime details bleed into contracts | Keep contract modules runtime-agnostic. Isolate Pi-specific code inside harness/. |
| Validation team too tightly coupled to one runtime flow | Keep validation logic separate from orchestration shell. Define narrow interfaces between contracts, validation, and harness. |
| False confidence from reviewer success alone | Preserve debrief, triage, and fail-secure semantics. Require full artifact emission before considering a run valid. |
| Pi SDK v0.64.0 API changes | Session factory is the only Pi-touching seam. API changes require surgery in one file, not across the codebase. |

---

## Summary

| Phase | Tasks | Delivers |
|-------|-------|---------|
| **0: Bootstrap** | 1 | Project scaffold |
| **1: Types** | 2-3 | Protocol types, prompt assembly |
| **2: Fixtures** | 4 | Golden test data for all contract modules |
| **3: Contracts** | 5-8 | Identity, triage, ledger, attestation |
| **4: Synthesis** | 9-11 | Debrief, verdict, config loader |
| **5: Kernel** | 12-17 | Session factory, invoker, domain lock, logging, events, custom tools |
| **6: Team** | 18 | Validation pipeline (full lifecycle) |
| **7: Surface** | 19-21 | CLI, agent definitions, prompts |
| **8: Validation** | 22 | End-to-end smoke test + parity check |

| Principle | Implementation |
|-----------|---------------|
| Protocol is the source of truth | All contracts reference sortie_protocol_v3.md sections |
| Fixtures before runtime | Golden data anchors behavior before Pi sessions are involved |
| SDK is the runtime | `createAgentSession()` for every reviewer via session factory |
| Contracts are runtime-agnostic | `src/contracts/` has zero Pi SDK imports |
| Tools are native | `customTools` calling TS contract modules directly |
| Domain locking | `beforeToolCall` hooks via Pi SDK |
| Observability | Session stats + event capture + conversation logging |
| Ledger has both detail and summary | Full findings for audit + summary fields for querying |
| Single seam for SDK changes | `session-factory.ts` is the only Pi-touching module |
| Python is a parity oracle only | Consulted during Task 22, not preserved as a runtime |
