## Security Review: Sortie Pi Repository (Phase 1-5)

### Summary
- **Findings**: 3 (1 Critical, 2 High)
- **Risk Level**: Critical
- **Confidence**: High

### Findings

#### [VULN-001] Sandbox Bypass via Bash Tool (Critical)
- **Location**: `src/harness/domain-lock.ts:133`
- **Confidence**: High
- **Issue**: The domain lock mechanism intentionally permits the `bash` tool unconditionally if the agent has any write patterns configured. Because `bash` allows arbitrary shell command execution, it completely undermines the file-path restrictions placed on the `write` and `edit` tools. 
- **Impact**: An LLM agent can trivially bypass "pattern-scoped write access" by executing shell commands (e.g., `bash -c "echo 'bad' > /etc/passwd"`), resulting in unconstrained host access.
- **Evidence**:
  ```typescript
  // Bash tool — blocked in read-only mode, allowed otherwise
  if (tool === "bash") {
    if (isReadOnly) {
      return {
        allowed: false,
        reason: "bash tool blocked — agent is in read-only mode (no write patterns)",
      };
    }
    return { allowed: true };
  }
  ```
- **Fix**: The `bash` tool must be completely disabled for any session that requires a domain lock. If `bash` is required for a specific task, it cannot securely operate alongside a scoped-path file restriction.

#### [VULN-002] Path Traversal & Absolute Path Bypass in Glob Logic (High)
- **Location**: `src/harness/domain-lock.ts:51`
- **Confidence**: High
- **Issue**: The `globToRegExp` function converts `**` into `.*` and does not anchor the path to the workspace root. The `normalize` function from `node:path` preserves absolute paths (e.g., `/etc/passwd`) and relative traversals that exceed the root (e.g., `../../etc/passwd`). Because `.*` matches `/`, patterns like `**/*.ts` will successfully match paths entirely outside the workspace.
- **Impact**: Even if `bash` was disabled, an LLM agent could supply an absolute path like `/etc/passwd.ts` or `../../../root/.ssh/authorized_keys` to the `write` or `edit` tools, successfully writing to system locations outside the intended repository bounds.
- **Evidence**:
  ```typescript
  function globToRegExp(pattern: string): RegExp {
    // ...
    if (ch === "*" && pattern[i + 1] === "*") {
      // ** — match anything including path separators
      re += ".*";
  ```
  And then verified later without path containment checks:
  ```typescript
  const normalizedPath = normalize(path);
  if (matchesAnyPattern(normalizedPath, compiled)) {
      return { allowed: true };
  }
  ```
- **Fix**: Before checking the pattern, resolve the path against the absolute workspace root using `path.resolve(cwd, path)` and explicitly verify that the resulting path begins with the workspace directory (`resolved.startsWith(cwd)`).

#### [VULN-003] Domain Lock Not Integrated into Session Factory (High)
- **Location**: `src/harness/session-factory.ts:60`
- **Confidence**: High
- **Issue**: Task 14 specifies that lead sessions should have write-capable tools scoped by the domain lock. However, `createLeadSession` and `buildLeadSessionConfig` simply pass the full, unrestricted `codingTools` array to the Pi SDK. The `createDomainLock` utility is never actually invoked outside of its test file.
- **Impact**: Lead sessions operate with zero restrictions on `bash`, `write`, and `edit` tools, breaking the Phase 5 containment requirements completely.
- **Evidence**:
  ```typescript
  export function buildLeadSessionConfig(
    config: DebriefConfig,
    options: SessionOptions,
  ): CreateAgentSessionOptions {
    const sessionConfig: CreateAgentSessionOptions = {
      cwd: options.cwd,
      model: resolveModel(config.provider, config.model),
      tools: codingTools, // <-- Full access, no domain lock wrapper applied
      sessionManager: SessionManager.inMemory(),
    };
  ```
- **Fix**: Update the `tools` definition in the Lead session configuration to intercept tool execution and evaluate the request using `createDomainLock`. If rejected, return a failure back to the agent rather than executing the tool.

### Needs Verification

#### [VERIFY-001] Uncontrolled Resource Consumption on LLM Timeout
- **Location**: `src/harness/invoker.ts:133`
- **Question**: When `invokeReviewer` triggers a timeout via `Promise.race`, the original `session.prompt(prompt)` Promise is abandoned but never aborted. Does the underlying Pi SDK cleanly terminate the background network request and stop consuming LLM tokens? If not, repeated timeouts could lead to significant token exhaustion or memory leaks.

#### [VERIFY-002] Agent-controlled `cwd` parameter execution
- **Location**: `src/contracts/identity.ts:63`
- **Question**: `getTreeSha(repoPath)` passes an agent-provided `repo_path` (from `identityTool`) into the `cwd` option of `execSync("git write-tree", { cwd: repoPath })`. While not direct command injection, can an agent point this to a malicious, agent-crafted directory containing a compromised `.git/config` that executes arbitrary code when `git` binaries run?