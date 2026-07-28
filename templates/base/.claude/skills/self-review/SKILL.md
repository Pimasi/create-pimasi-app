---
name: self-review
description: "Audit your own work from this session before handing it back. Use when the user asks you to check, verify, review, or double-check what you did ('check your work', 'review your changes', 'are you sure it's done?'). Rebuilds the change inventory from the working tree instead of memory, re-derives requirements from the user's messages, hunts for defects, runs the project checks, and reports READY / NOT READY / UNVERIFIED with evidence."
---

# Self-review: check your own work

You are reviewing work you produced in this session, usually uncommitted in the
working tree. Your memory of what you did is a claim, not evidence: sessions
forget files they touched, believe tests exist that were never written, and
remember a check as green that last ran before the final edits. Session context
tells you what was intended; only the tree and the commands tell you what is.

**Assume at least one thing is wrong and hunt for it.** A self-review that only
confirms success has failed. You hold one advantage over an outside reviewer
(you know the requirements and every decision taken along the way) and one
handicap (you will anchor on your own reasoning). Use the first. Defend against
the second.

## Ground rules

- Anything you "remember" doing counts only once re-verified in the tree or by
  re-running the command.
- A deterministic check outranks your reasoning: a failing `make test` is a
  real finding however correct the code looks.
- Fix unambiguous defects in your own new work, then re-run the affected
  checks. Where a fix needs a judgement call (two reasonable designs, a
  wire-format change, scope beyond the original task), report it and ask: see
  "Clarify before deciding" in the README.
- Judge this session's work only. Keep pre-existing defects out of the verdict;
  report a severe one separately.
- Do not pad the report. Three verified findings beat ten plausible ones.

## 1. Rebuild the change inventory from the tree

Run `git status`, read the staged AND unstaged diffs, and list untracked files
(read those directly: diffs omit them). Include any commits you made this
session. Then compare the inventory against your memory, in both directions:

- **In the tree but not intended**: stray edits, debug residue, temporary
  files, plans outside `.scratch/`.
- **Intended but absent**: files you believe you created or edited that are
  missing or unchanged.

Both directions are findings, not surprises to silently absorb.

## 2. Re-derive the requirements

Re-read the user's actual messages from this session (plus any plan under
`.scratch/`) and the README sections covering the surfaces you touched. Write
out the acceptance criteria in the user's words BEFORE re-reading your diff,
then map each one:

```
requirement -> where implemented -> evidence (file:line, test, command output)
```

An unmapped requirement is a finding. So is unrequested scope.

## 3. Review the diff as if a stranger wrote it

Read every changed file in full, not just the hunks. Work through
[references/failure-modes.md](references/failure-modes.md): the self-review
failure modes first, then the project checklist for the surfaces you touched.
Spend effort by risk: auth, migrations and schema changes, shared contracts in
`@pimasi/lib`, money, concurrency, anything on the wire.

For each changed unit, trace inputs through transformations to side effects on
the failure path as well as the success path, and search for consumers you did
not update: callers, schemas, fixtures, generated types, docs.

If your harness supports subagents, hand one the raw request and the diff with
none of your conclusions, and treat what comes back as leads to verify, not
findings.

## 4. Run the project's checks

Evidence from before your last edit is stale. Re-run.

| Layer   | Command                                             | Rules                                                                                                 |
| ------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Static  | `make type-check`                                   | Host-side, no stack needed.                                                                            |
| Tests   | `make test` or `make test ARGS="<path or pattern>"` | Inside Docker, always; never host `vitest`. Bring the stack up first (`make dev`) if it is not running. |
| Runtime | `make dev`, then exercise the changed behaviour     | When behaviour is observable: hit the endpoint, load the page.                                         |

Discover anything further in the Makefile and README rather than inventing
commands. Record every check as `passed`, `failed`, or `not run` (with the
reason). Never report a result you did not observe after your final edit.

## 5. Gate every finding

Before a candidate reaches the report:

1. **Trigger**: name the input, state, or sequence that reaches it.
2. **Mechanism**: trace how the changed code produces the failure.
3. **Impact**: state the concrete consequence for users, data, or operations.
4. **Attribution**: this session introduced it (otherwise it is pre-existing
   and belongs in its own section, not the verdict).
5. **Falsification**: try to disprove it first: upstream validation, existing
   handling, a test that contradicts it.
6. **Location**: exact `path:line` in the final tree; merge duplicates by root
   cause.

Severity: **P0** stop-ship (data loss, auth bypass, leaked secrets), **P1**
core behaviour broken, **P2** real defect with a bounded blast radius, **P3**
minor and non-blocking. Style taste is not a finding.

## 6. Fix, re-verify, report

Apply fixes per the ground rules and re-run the affected checks after the last
fix. Then deliver:

```markdown
## Self-review: NOT READY

One sentence tying the verdict to the strongest evidence.

**Scope**: 7 files vs HEAD `abc1234` (1 untracked). Requirement: "<the user's words>"

**Findings**

1. [P1 | fixed] `apps/server/src/handlers/...:42`: trigger, mechanism, impact.
   Re-ran `make test ARGS="..."`: green.
2. [P2 | open] `apps/web/src/...:88`: needs a decision: <A or B>?

**Validation**

| Check                                  | Outcome                       |
| -------------------------------------- | ----------------------------- |
| `make type-check`                      | passed                        |
| `make test ARGS="src/handlers/widget"` | failed, then passed after fix 1 |
| Runtime check of `/widgets`            | not run: stack down           |

**Residual risk**: what was not validated, and why it matters.
```

Verdicts:

- **READY**: every requirement maps to evidence, no open P0-P2 findings, and
  checks proportionate to the risk ran and passed.
- **NOT READY**: an open P0-P2 finding or unmet requirement remains. Say what
  needs doing or deciding.
- **UNVERIFIED**: a material check could not run (stack down, missing env,
  missing credentials). Name it and say why. Never dress UNVERIFIED up as
  READY.
