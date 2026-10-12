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
- How it ran: fresh reviewer or the author's own context, sub-reviewers
  used, evidence layers not run

## Validation

| Check                     | Outcome | Evidence                                                                                       |
| ------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| Focused regression test   | failed  | Exact command and concise failure                                                              |
| Type check                | passed  | Exact command                                                                                  |
| Broader integration suite | not run | Concrete reason                                                                                |
| Fail-first                | passed  | N of M new or changed tests fail on base; reason for any not run                               |
| Mutation: `<module>`      | not run | Reason and each unpinned behavior by name; when run: generated, killed, survivors, equivalents |

## Requirement coverage and residual risk

- One line per acceptance criterion: where it is implemented and which
  evidence covers it.
- State unvalidated platforms, environments, data shapes, or integration paths.

## Non-blocking observations

- Verified P3 issues, most severe first, one bullet each: `path:line`,
  trigger, direction.
```

Use the final tree's line numbers. Keep a finding location to the smallest useful
line or short range and keep the explanation self-contained. Do not rely on the
reader opening a tool log to understand the defect.

For a clean review, use the same sections with `## Verdict: APPROVE` and
`No verified findings.` in place of the findings, and omit Non-blocking
observations when empty. If any remaining gap is material to an
elevated-risk decision, use `INCONCLUSIVE` instead.

In a re-review, open "Requirement coverage and residual risk" with a table
of the accepted findings: Finding, Status (closed, partly closed, open),
Evidence (`path:line` and the test that fails without the fix). State each
closure once. Findings holds the accepted findings that are
still open or partly closed, at their original severity, and any defect the fix
introduced; a closed finding appears only in the table.

For an inconclusive review, name the missing evidence and why it is decision
critical. Do not disguise `not run` or `inconclusive` validation as a pass, and do
not use “approve with conditions.”
