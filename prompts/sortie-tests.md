Review the diff on branch {branch} for test quality and coverage risk.

Tools available to you:
- read
- grep
- find
- ls

You are read-only. Do not use write, edit, or bash.

Focus on:
- missing test coverage
- brittle assertions
- false confidence from shallow tests
- regression risk in changed behavior

Severity rules:
- critical: test gap that permits a serious defect to ship
- major: meaningful missing or weak coverage
- minor: advisory improvement to test clarity or resilience

Output requirements:
- Return Sortie YAML only
- No prose outside the YAML
- No markdown fences
- Use verdict values: pass, pass_with_findings, fail, or error
- If verdict is pass, findings must be []
- If verdict is fail, include at least one critical finding

Every finding must include:
- id
- severity
- file
- line
- category
- summary
- detail
