---
name: code-review
description: "Independent, evidence-driven review of a completed change, ending in an APPROVE, REQUEST CHANGES, or INCONCLUSIVE verdict backed by mechanical test-strength evidence: a fail-first check of new tests against the base revision, CRAP scores on changed methods, and targeted differential mutation testing. Use whenever the user asks to review, verify, check, or double-check work, whether written by Claude, another agent, or a human: review your changes, verify your work, check your work, are you sure it's done, check the diff, review this branch or PR, pre-merge check, or audit an implementation before merging. Covers uncommitted session work as well as branches and PRs. Also defines the fix discipline after a review: failing test first, red-green, CRAP of 8 or less, then re-review the new diff."
---

# Code review

Review a completed change as an independent quality gate and return one
verdict. The change may be another agent's work or your own from this
session. When it is your own, your memory of writing it is a lead, not
evidence: re-derive scope, intent, and correctness from the artifacts, and
hand review passes to independent subagents when they are available.

## Operating contract

- Stay read-only during the review. Do not patch code, update snapshots,
  regenerate artifacts, or tidy the tree. Fixes happen only in the fix loop
  below, and only when the user asks for them.
- Preserve worktree state. Never stash, reset, checkout, or clean the
  reviewed tree. When a step needs the base revision, use a separate
  `git worktree` in a temporary directory and remove it afterwards.
- Judge the requested scope only. Separate severe pre-existing defects from
  change-attributable findings, and drop unrelated nits.
- Prefer demonstrated behavioral risk over taste, speculation, or diff size.
- Record what was inspected, what was run, and what remained unavailable.

## Review flow

### 1. Freeze the boundary

Establish the review unit before analyzing anything: the base, head, commit
range, PR, or file set the user supplied, or else the most defensible
inferred base. State the inference; ask only when plausible bases materially
change scope. For uncommitted session work, the base is HEAD. For a dirty
tree, inventory staged, unstaged, and untracked work separately, and read
untracked files directly because a diff omits them.

Resolve movable refs to immutable object IDs and fingerprint the scoped
patch. Recheck before long validation and before reporting. If the tree
changed mid-review, re-anchor or restart the affected pass rather than mixing
evidence from different trees.

### 2. Reconstruct intent independently

Read the original request, acceptance criteria, repository rules, and
relevant tests before accepting the implementation's shape as the intended
design. Build a change map: requirement, changed entry point, affected
contracts and consumers, evidence. Compare it with the author's hand-off (or
your own recollection) only after forming an independent view. Classify gaps
as omitted requirement, extra scope, unintended behavior, or ambiguity.

### 3. Review by risk, in independent passes

Rank plausible failure modes by impact, reachability, blast radius, and
reversibility. Elevate authentication and secrets, payments and destructive
writes, migrations and public contracts, concurrency, and CI or deployment
changes. Read [references/risk-lenses.md](references/risk-lenses.md) and
apply every section that matches the changed surfaces; use the prompts to
guide inspection, never as automatic findings.

Read complete changed units, not isolated hunks, in five separate passes:

1. **Scope and contract**: trace every requirement; flag unrelated or
   incomplete work.
2. **Correctness and failure**: follow success paths, boundary values, and
   state transitions, then malformed, duplicate, stale, concurrent, and
   cancelled paths.
3. **Integration and compatibility**: callers, schemas, migrations,
   configuration, and mixed-version behavior.
4. **Test integrity**: confirm tests exercise production behavior with
   meaningful assertions, including negative paths.
5. **Cold final pass**: reread the request and the final diff after
   validation to catch omissions and anchored conclusions.

For broad or high-risk changes, and always when reviewing your own work,
give each pass to an independent sub-reviewer with the raw request, the
exact boundary, and one lens; never seed them with suspected defects or
other reviewers' conclusions. Verify every returned candidate personally
before reporting it.

### 4. Validate with evidence, cheapest first

Discover canonical commands from repository instructions, manifests, and CI.
Never invent a command or inherit a green result from the author. Distinguish
passed, failed, not run, and inconclusive; explain environmental failures
without relabeling them as code failures. Layer the evidence:

1. **Project checks**: diff hygiene, focused tests for the changed behavior,
   then type, lint, and build checks as proportionate.
2. **Fail-first check**: run the change's new or modified tests against the
   base revision in a separate worktree. A new test that also passes on base
   is not testing this change; report that as a test-integrity finding.
3. **CRAP signal**: score changed methods with
   `CRAP = comp^2 * (1 - cov)^3 + comp` (comp is cyclomatic complexity, cov
   is unit-test coverage from 0.0 to 1.0). Treat scores above 8 as a
   maintainability signal to report, not an automatic defect.
4. **Differential mutation testing** on high-risk or branch-heavy changed
   modules: mutate only the diff, one module at a time, workers capped at 3
   (max-workers, threads, concurrency, or jobs, depending on the tool).
   Uncovered mutation sites and surviving mutants are candidate findings
   about test strength.

Formula detail, per-ecosystem tooling, and mutation commands are in
[references/crap-and-mutation.md](references/crap-and-mutation.md). Exclude
deploy, publish, production, and destructive-migration commands from review
validation.

### 5. Gate findings and deliver the verdict

Apply the evidence gate in
[references/severity-and-evidence.md](references/severity-and-evidence.md)
to every candidate: introduced by this scope, reachable under a supported or
realistically hostile scenario, concrete impact, supported by direct evidence
or complete code-path reasoning, one root cause rather than a duplicate
symptom. Discard what fails the gate; put material unresolved uncertainty
under residual risk.

Report with [references/report-template.md](references/report-template.md).
Lead with one verdict (**APPROVE**, **REQUEST CHANGES**, or
**INCONCLUSIVE**), then findings in descending severity, each with an exact
`path:line`, a reachable trigger, the impact, the evidence, and a minimal
correction direction. Include the mechanical evidence: fail-first results,
worst CRAP scores per module, and per-module mutation outcomes (generated,
killed, survivors, equivalents). If nothing passes the gate, say
`No verified findings` and still disclose scope, commands run, validation
gaps, and residual risk.

## Fix loop (only when the user asks for fixes)

Apply this discipline to every accepted finding:

1. Write the test first: an acceptance-level scenario for behavior visible
   from outside, a unit test otherwise. Confirm it fails for the right
   reason. Ask before modifying or deleting any existing acceptance scenario.
2. Fix red-green: write just enough production code to pass, repeated until
   the new tests pass.
3. Refactor the changed methods until CRAP is 8 or less, and kill the
   specific mutation survivors that motivated the finding.
4. Freeze the new diff and re-review it from step 1 of the review flow. A
   fix is a new change; it inherits no approval.
