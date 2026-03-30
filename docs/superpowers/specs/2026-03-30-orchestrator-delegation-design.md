# Orchestrator Delegation Design

## Context

Sortie Pi has a complete protocol engine (contracts, tools, harness, pipeline, CLI) with 738 tests across 48 files. The current entry point is an imperative `runPipeline()` function called from the CLI.

The target architecture, based on the original product, is a conversational multi-agent system where the human interacts with an orchestrator agent in the Pi terminal. The orchestrator delegates to lead agents ("lead sorties"), which in turn delegate to worker agents ("worker sorties"). The pipeline stays as a parallel programmatic/CI path.

This spec covers the full multi-lead framework but only implements the validation lead as the first concrete sortie. Additional leads (architectural, financial, marketing, etc.) follow in future specs.

## Terminology

- **Orchestrator** — the human-facing agent in the Pi terminal. Long-lived, conversational, stateful across the session.
- **Lead sortie** — a lead agent dispatched by the orchestrator (e.g., validation-lead). Scoped to a task, disposes when done.
- **Worker sortie** — a worker agent dispatched by a lead (e.g., reviewer-claude). Leaf node, disposes after invocation.
- **Sortie** — general term for any delegated agent (lead or worker).

## Agent Hierarchy

```
Human <-> Orchestrator (long-lived Pi session in terminal)
              |
              +-- delegate -> Validation Lead (lead sortie)
              |       +-- delegate -> Reviewer-Claude (worker sortie)
              |       +-- delegate -> Reviewer-Gemini (worker sortie)
              |       +-- delegate -> Reviewer-Codex (worker sortie)
              |
              +-- delegate -> Architectural Lead (future)
              +-- delegate -> Financial Lead (future)
              +-- ...
```

Three tiers, one primitive (`delegate`). The orchestrator and leads can delegate. Workers cannot — they are leaf nodes with read/write tools but no delegation capability.

## Config: Sortie Registry

Agent definitions live in `.pi/agents/*.md` (YAML frontmatter for model, markdown body for system prompt). The config registers which sorties are available and their hierarchy.

Extension to `harness.yaml`:

```yaml
# Existing sections (roster, debrief, triage, modes, etc.) unchanged.

sorties:
  orchestrator:
    definition: .pi/agents/orchestrator.md
    tools: [delegate, sortie-triage, sortie-ledger, sortie-identity]
    can_delegate_to: [validation-lead]

  validation-lead:
    definition: .pi/agents/validation-lead.md
    role: lead
    tools: [delegate, sortie-triage, sortie-ledger, sortie-identity, read, grep, find, ls]
    can_delegate_to: [reviewer-claude, reviewer-gemini, reviewer-codex]
    write_scope: .sortie/**

  reviewer-claude:
    definition: .pi/agents/reviewer-claude.md
    role: worker
    tools: [read, write, edit, grep, find, ls]
    can_delegate_to: []

  reviewer-gemini:
    definition: .pi/agents/reviewer-gemini.md
    role: worker
    tools: [read, write, edit, grep, find, ls]
    can_delegate_to: []

  reviewer-codex:
    definition: .pi/agents/reviewer-codex.md
    role: worker
    tools: [read, write, edit, grep, find, ls]
    can_delegate_to: []
```

**What comes from where:**
- **Model** — `.pi/agents/*.md` frontmatter `model:` field
- **System prompt** — `.pi/agents/*.md` body (below frontmatter)
- **Tools** — config `sorties.{name}.tools` (authoritative, overrides frontmatter)
- **Delegation scope** — config `sorties.{name}.can_delegate_to`
- **Write scope** — config `sorties.{name}.write_scope` (applied via domain lock)
- **Role** — inferred: has `can_delegate_to` entries = lead, empty = worker, top-level = orchestrator

## The `delegate` Tool

The core primitive. Same implementation at orchestrator and lead tiers. Workers do not have it.

### Interface

```typescript
// Input
{
  sortie: string;     // name from config sorties section
  task: string;       // natural language task description
  context?: string;   // optional additional context from parent
}

// Output
{
  sortie: string;
  result: string;     // child's final assistant text
  tokens: { input: number; output: number; total: number };
  cost: number;
  wall_time_ms: number;
  error: string | null;
}
```

### Execution Flow

1. Look up `sortie` name in the agent registry
2. Verify the caller has `sortie` in its `can_delegate_to` — reject if not
3. Load the agent definition from the path in config — parse frontmatter for model, body for system prompt
4. Resolve the tool set from config — map tool names to Pi SDK built-in tools + sortie custom tools. Include `delegate` only if the sortie has non-empty `can_delegate_to`.
5. Create a child `AgentSession` via session factory (model, system prompt, tools, cwd, in-memory session manager)
6. Apply domain lock if `write_scope` is configured
7. Prompt the child session with `task` (prepend `context` if provided)
8. While the child runs: emit compact progress lines to the parent via `sendCustomMessage()`
9. When the child completes: capture `getLastAssistantText()` + `getSessionStats()`
10. Dispose the child session
11. Return structured result as tool output

### Parallel Delegation

When an LLM emits multiple `delegate` tool calls in a single turn, the Pi SDK executes them concurrently. This is how a lead dispatches N reviewer sorties in parallel — no special code needed.

### Error Handling

- Child session timeout: dispose session, return error result
- Child session crash: catch, dispose, return error result
- Unknown sortie name: return error immediately
- Delegation scope violation: return error immediately
- All errors are non-fatal to the parent — the parent LLM decides how to handle

## The `plan` Tool

Deferred from this spec. The orchestrator's system prompt includes guidance on how to decompose requests. Leads are instructed via their system prompts that they may assess a delegated task and decline if it is outside their scope or does not require action. If orchestrator delegation quality proves insufficient in practice, `plan` will be added in a follow-up spec.

## Progress Reporting

Claude Code subagent style. Compact single-line status updates per sortie while running, orchestrator owns the final summary.

### Mechanism

The `delegate` tool emits progress via Pi SDK's `sendCustomMessage()` with a custom message type:

```typescript
sendCustomMessage({
  customType: "sortie:progress",
  content: { sortie: "reviewer-claude", status: "reviewing diff (2,145 tokens)" },
  display: "reviewer-claude: reviewing diff (2,145 tokens)",
});
```

### What the Human Sees

```
You: review the auth branch

Orchestrator: Dispatching validation-lead for code review on feature/auth...

  > validation-lead: dispatching 3 reviewer sorties...
  > reviewer-claude: reviewing diff (2,145 tokens)
  > reviewer-gemini: reviewing diff (1,891 tokens)
  > reviewer-codex: reviewing diff (2,340 tokens)
  > reviewer-claude: complete -- fail (2 findings)
  > reviewer-gemini: complete -- pass_with_findings (1 finding)
  > reviewer-codex: complete -- pass
  > validation-lead: debrief synthesis...
  > validation-lead: complete -- verdict: fail, 2 findings (1 convergent critical)

Orchestrator: [LLM-generated summary of results]
```

Progress lines are emitted by the `delegate` tool. The final summary is generated by the orchestrator LLM from the structured delegate result.

## Orchestrator Startup

When the Pi terminal launches:

1. Load `harness.yaml` — read the `sorties` section
2. Build the agent registry in memory — all sorties, their definitions, tool sets, delegation scopes
3. Parse `.pi/agents/orchestrator.md` — extract model + system prompt
4. Inject registry summary into the system prompt so the orchestrator knows what sorties are available:
   ```
   Available sorties:
   - validation-lead: Code review, test review, docs review.
     Can dispatch: reviewer-claude, reviewer-gemini, reviewer-codex.
   ```
5. Resolve tools: `delegate` + sortie custom tools from config
6. Create the orchestrator `AgentSession`
7. Hand control to the human

### Conversational Loop

After a delegation completes, the orchestrator session stays alive. The human can:
- Ask follow-ups ("explain CF001 in detail") — orchestrator reasons from context
- Dispose findings ("mark CF001 as fixed") — orchestrator calls `sortie-ledger` directly
- Re-run ("run again on tests mode") — orchestrator delegates again
- Switch domains ("now review the docs") — new delegation
- Query status ("show me recent runs") — orchestrator calls `sortie-ledger`

No special state machine. The orchestrator LLM has the tools, the conversation history, and the system prompt guidance.

## Validation Lead: First Concrete Sortie

The validation lead replaces the imperative `pipeline.ts` control flow with agent-driven delegation. It uses the same contracts and tools.

### What the Validation Lead Does

When delegated a task like "review feature/auth in code mode":

1. Call `sortie-identity` to get tree SHA, cycle, run ID
2. Create the run directory via file-write tools
3. Determine which reviewer sorties to dispatch — the orchestrator passes the mode and roster information as part of the `context` field in the delegate call, derived from the existing `harness.yaml` modes/roster config
4. Call `delegate` N times (one per reviewer) — parallel via Pi SDK
5. Collect reviewer results from delegate returns
6. Perform debrief synthesis directly — the lead IS the debrief model, it reasons over the reviewer outputs rather than spawning another session
7. Call `sortie-triage` for the merge decision
8. Write verdict, attestations, and ledger entry via sortie tools
9. Return structured result to the orchestrator

### What Stays the Same

- All contracts (identity, triage, ledger, attestation, verdict, debrief)
- All custom tools (sortie-triage, sortie-ledger, sortie-identity)
- Domain lock scoping (enforced when creating the lead's session)
- Fail-secure behavior (all reviewers error = error verdict = block)
- Artifact format and deposition layout

### What Changes

- Control flow moves from `pipeline.ts` into the lead's LLM reasoning guided by its system prompt
- Reviewers are worker sorties, not programmatic `invokeAll()` calls
- Debrief is the lead's own synthesis, not a separate session
- Artifact writing happens through tools, not imperative `writeFileSync` calls

### Risk Mitigation

The lead's behavior is LLM-driven rather than deterministic. Mitigations:
- System prompt is highly prescriptive about protocol steps and ordering
- Tools enforce correctness: triage is deterministic, ledger validates structure, attestation format is fixed
- `pipeline.ts` stays as the programmatic/CI path — deterministic behavior is always available

## Module Structure

### New Modules

```
src/orchestrator/
  bootstrap.ts          -- load config, build registry, create orchestrator session
  registry.ts           -- parse agent definitions, resolve tools, lookup sorties
  delegate-tool.ts      -- the delegate custom tool implementation
  progress.ts           -- compact progress line emission via sendCustomMessage
  index.ts              -- public API: startOrchestrator(configPath, cwd)
```

### Dependency Direction

```
contracts -> harness -> tools -> orchestrator
                                      |
                                validation (pipeline.ts stays as CI path)
                                      |
                                     cli
```

The orchestrator layer depends on harness (session factory, config, domain lock) and tools (sortie custom tools + delegate). It does NOT depend on `pipeline.ts`.

### Public API

```typescript
// src/orchestrator/index.ts
export async function startOrchestrator(
  configPath: string,
  cwd: string,
): Promise<{ session: AgentSession; dispose: () => void }>;
```

Returns a live orchestrator session. The caller (Pi terminal or a test harness) interacts with it via `session.sendUserMessage()` or `session.prompt()`.

## Agent Definition Updates

The `.pi/agents/*.md` files need system prompt updates to reflect the delegation model:

- **orchestrator.md** — guidance on decomposing requests, delegating to leads, summarizing results, handling follow-ups. List of available sortie tools.
- **validation-lead.md** — prescriptive protocol steps (identity, dispatch reviewers, synthesize, triage, write artifacts). Guidance that it may decline a task if outside scope.
- **reviewer-*.md** — unchanged (read/write, strict YAML output, severity definitions).

## Testing Strategy

### Unit Tests

- `registry.test.ts` — parse agent definitions from fixtures, resolve tool sets, enforce `can_delegate_to` constraints, reject unknown sorties, handle missing definitions
- `delegate-tool.test.ts` — mock child session creation/prompting/disposal, verify parallel execution, verify progress emission, verify error handling (child timeout, child crash), verify delegation scope enforcement, verify domain lock application
- `progress.test.ts` — verify message formatting, verify `sendCustomMessage` calls with correct custom type

### Integration Tests

- `bootstrap.test.ts` — load real config with sorties section, build registry, verify orchestrator session created with correct tools and system prompt injection
- `delegation-chain.test.ts` — mock session factory, verify orchestrator -> lead -> worker chain, results propagate up, all sessions dispose

### What We Mock

Session factory — same seam as existing pipeline tests. `createAgentSession` is the boundary.

### What We Do Not Test

Whether the orchestrator or lead LLMs make good delegation decisions. That is prompt engineering, validated manually.

### Existing Tests

All existing tests (pipeline, contracts, CLI, harness) stay unchanged. The orchestrator is additive.

## Out of Scope

- **`plan` tool** — deferred, orchestrator reasons about delegation without it
- **Non-validation leads** — framework supports them, none implemented in this spec
- **Streaming child output to human** — only compact progress lines, not full output
- **Persistent orchestrator state across terminal restarts** — in-memory sessions only
- **Authentication/authorization between agents** — all agents run in the same process
