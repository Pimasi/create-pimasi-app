# Review report template

Keep the report compact. Omit empty optional sections, but never omit validation
gaps or residual risk.

```markdown
## Verdict: REQUEST CHANGES

One sentence tying the verdict to the highest-impact evidence.

## Findings

### [P1 | High confidence] Prevent duplicate fulfilment on webhook replay

`path/to/changed-file.ts:123`

When the provider retries an already-accepted event, the changed path performs
fulfilment before checking the durable idempotency record. The same purchase can
therefore be credited twice. A focused replay test fails with two ledger entries.

Direction: make the durable uniqueness/idempotency decision precede fulfilment in
the same atomic boundary.

## Scope reviewed

- Base/head: `<base>...<head>` using merge base `<sha>`
- Worktree: staged, unstaged, and untracked changes included as applicable
- Exclusions or assumptions: none

## Validation

| Check                     | Outcome | Evidence                          |
| ------------------------- | ------- | --------------------------------- |
| Focused regression test   | failed  | Exact command and concise failure |
| Type check                | passed  | Exact command                     |
| Broader integration suite | not run | Concrete reason                   |

## Requirement coverage and residual risk

- Trace material acceptance criteria to reviewed implementation and evidence.
- State unvalidated platforms, environments, data shapes, or integration paths.

## Non-blocking observations

- Include only verified P3 issues or a small number of useful questions.
```

Use the final tree's line numbers. Keep a finding location to the smallest useful
line or short range and keep the explanation self-contained. Do not rely on the
reader opening a tool log to understand the defect.

For a clean review, use:

```markdown
## Verdict: APPROVE

No verified findings.

## Scope reviewed

- Base/head and worktree layers
- Material files, contracts, and consumers inspected

## Validation

| Check                 | Outcome | Evidence        |
| --------------------- | ------- | --------------- |
| `<exact command>`     | passed  | Concise result  |
| `<unavailable check>` | not run | Concrete reason |

## Requirement coverage and residual risk

- Summarise requirement-to-evidence coverage.
- State remaining gaps explicitly; use `INCONCLUSIVE` instead if any gap is
  material to an elevated-risk decision.
```

For an inconclusive review, name the missing evidence and why it is decision
critical. Do not disguise `not run` or `inconclusive` validation as a pass, and do
not use “approve with conditions.”
