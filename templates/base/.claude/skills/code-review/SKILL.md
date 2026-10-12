---
name: code-review
description: "Independent review of a completed code change (uncommitted work,
  branch, commit range or PR) by a fresh read-only reviewer. Use when asked to
  review or check finished work or a diff, to audit an implementation, or for
  a pre-merge check; not for a question about one function or behaviour.
  Returns APPROVE, REQUEST CHANGES or INCONCLUSIVE with fail-first and
  targeted mutation evidence. Defines the test-first fix loop and the
  single-reviewer re-review."
---

# Code review

Review a completed change as an independent quality gate and return one
verdict. The change may be another agent's work or your own from this
session. When it is your own, your memory of writing it is a lead, not
evidence: re-derive scope, intent, and correctness from the artifacts. Arrange
independent passes as described below.

## Who runs this

A fresh reviewer that did not write the change runs the review: a different
model when the user's setup provides one, otherwise a fresh session or
sub-agent of the same model that carries none of the authoring context. The
originating agent hands the whole review to that reviewer instead of
reviewing it itself. Where the user's or the project's own rules name a
reviewer, those rules decide. An agent that can start neither runs every pass
itself in its current context and says so in the report.

The hand-off prompt and the verdict live under the gitignored `.scratch/`
folder and are never committed.

The fresh reviewer has none of the originating conversation's context, so
the prompt must carry everything the flow below needs:

1. the boundary from step 1 as immutable object IDs (base and head, a PR, or
   "uncommitted work on top of `<HEAD sha>`"), so the reviewer does not
   re-infer it;
2. the original request and acceptance criteria, quoted verbatim;
3. an instruction to read this file and follow the review flow end to end,
   opening each reference at the step that names it, staying read-only on
   the reviewed tree; and
4. an instruction to finish with the report from
   [references/report-template.md](references/report-template.md).

A re-review prompt names itself a re-review, takes the fix diff as its
boundary and lists the accepted findings the fix must close.

Running the tests can require a sandbox that also allows writes. Nothing
but the prompt then keeps the reviewer off the tree, so state the read-only
contract explicitly, record `git status --porcelain`,
`git diff HEAD | sha256sum` and a hash of each untracked file
(`git ls-files -o --exclude-standard`) before the run, and report any
difference after it.

Relay the verdict as written, mechanical evidence included, without
re-reviewing or softening it.

The fresh reviewer follows the operating contract and review flow below
directly; it does not dispatch the whole review again. The fix loop stays
with whichever agent the user asks to fix; the re-review it ends with goes
to a fresh reviewer the same way and runs as one reviewer (step 3).

## Operating contract

- Stay read-only during the review. Do not patch code, update snapshots,
  regenerate artifacts, or tidy the tree. Fixes happen only in the fix loop
  below, and only when the user asks for them.
- Preserve worktree state. Never stash, reset, checkout, or clean the
  reviewed tree. When a step needs the base revision or a mutated file, use
  a separate `git worktree` or a throwaway copy in a temporary directory and
  remove it afterwards. Never run base or mutant code where a running
  service, a file watcher, a shared database or another session would pick
  it up. When no isolated copy can run the tests, reason through the code
  path instead and label the result `not run`.
- Judge the requested scope only. Separate severe pre-existing defects from
  change-attributable findings, and drop unrelated nits.
- Cleanup is out of scope. Reuse, simplification and efficiency notes with
  no demonstrated behavioral or operational impact are not findings.
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
as omitted requirement, extra scope, unintended behavior, ambiguity, or a
defect in the plan or brief that the build followed faithfully. Say which in
each finding: the last kind goes back to whoever owns the plan, not to the
builder.

### 3. Review by risk, in independent passes

Rank plausible failure modes by impact, reachability, blast radius, and
reversibility. Elevate authentication and secrets, payments and destructive
writes, migrations and public contracts, concurrency, and CI or deployment
changes. Read [references/risk-lenses.md](references/risk-lenses.md) and
apply every section that matches the changed surfaces; use the prompts to
guide inspection, never as automatic findings.

Read complete changed units, not isolated hunks, in five separate passes:

1. **Scope and contract**: trace every requirement and every repository
   rule that explicitly governs the touched paths, citing the rule; flag
   unrelated or incomplete work.
2. **Correctness and failure**: follow success paths, boundary values, and
   state transitions, then malformed, duplicate, stale, concurrent, and
   cancelled paths. For every line the diff deletes or replaces, name the
   behavior it enforced and find where the new code re-establishes it; a
   guard, error path, validation or test with no replacement is a candidate.
3. **Integration and compatibility**: callers, schemas, migrations,
   configuration, and mixed-version behavior.
4. **Test integrity**: confirm tests exercise production behavior with
   meaningful assertions, including negative paths, and name every changed
   function or method that no test reaches.
5. **Cold final pass**: reread the request and the final diff after
   validation to catch omissions and anchored conclusions.

One reviewer makes all five passes by default. On a first review of a broad
or high-risk change, the lead keeps passes 1 and 5 and gives passes 2, 3 and
4 to one independent sub-reviewer each, with the raw request, the exact
boundary, the operating contract and one lens; never seed them with
suspected defects or other reviewers' conclusions. Sub-reviewers are fresh
sessions or sub-agents on the reviewer's side, never the author's. They only
read: the lead runs each check in step 4 once. Each returns candidates most
severe first, with a `path:line`, a one-line claim and the input or state
that triggers it, plus one line for each area checked and found sound, and
leaves the evidence gate to the lead. The lead merges candidates that point
at the same line or mechanism and verifies each one personally before
reporting it. A lead that cannot start sub-reviewers makes every pass itself
and says so in the report.

A re-review of a fix diff always runs as one reviewer. Each sub-reviewer
repeats the same repository reading, and on a fix diff that reading
outweighs the review.

### 4. Validate with evidence, cheapest first

Discover canonical commands from repository instructions, manifests, and CI.
Never invent a command or inherit a green result from the author. Distinguish
passed, failed, not run, and inconclusive; explain environmental failures
without relabeling them as code failures. Layer the evidence:

1. **Project checks**: diff hygiene, then tests, then type, lint, and build
   checks as proportionate. Never stop at the author's test list. Run the
   tests for the changed behavior, every existing test that imports or
   asserts on a changed symbol even when the change left that test untouched
   (search for the changed exports to find them), and the test file beside
   each changed call site. Run the whole suite when the project's rules and
   time allow.
2. **Fail-first check**: show one counterfactual under which each new or
   modified test fails. Run the tests that exercise code already present on
   base against the base revision in an isolated copy. Count a red only when
   an assertion fails; a missing-module or collection error is not evidence,
   so skip tests of wholly new modules or endpoints and say so. A test that
   calls a running server proves nothing from a copy while that server runs
   head: start a base server from the copy and point the tests at it, or
   trace the base code path and record the check as `not run`, naming the
   counterfactual. A test that passes on base is a candidate, not yet a
   finding: keep it when it is a guard for behavior the change must leave
   alone, or when a mutant of the line it claims to pin makes it fail. A
   test with no failing counterfactual is a test-integrity finding.
3. **Differential mutation testing**, only on changed modules whose
   branching production logic carries risk, and on any behavior whose
   existing tests the diff modified, re-pointed or deleted. Skip it, and say
   so in one line, when the diff holds no such logic (docs, config, copy,
   markup, styling); a test-only diff is not a skip. When the mutants cannot
   be executed, record the layer as `not run` with the reason, name each
   changed behavior that no assertion pins, and give no generated or killed
   counts. Survivors and uncovered sites are candidate findings about test
   strength.

Only when you run mutation testing, read
[references/mutation-testing.md](references/mutation-testing.md) for the
terms, the review procedure and the tool commands. Exclude
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
correction direction. Include the mechanical evidence: fail-first results
and, for mutation runs that executed, per-module outcomes (generated,
killed, survivors, equivalents); for a layer not run, the reason and the
unpinned behaviors by name. Full finding blocks are for P0 to P2; P3s go
under Non-blocking observations as one bullet each.
If nothing passes the gate, say `No verified findings` and
still disclose scope, commands run, validation gaps, and residual risk.

## Fix loop (only when the user asks for fixes)

Apply this discipline to every accepted finding:

1. Write the test first: an acceptance-level scenario for behavior visible
   from outside, a unit test otherwise. Confirm it fails for the right
   reason. Ask before modifying or deleting any existing acceptance scenario.
2. Fix red-green: write just enough production code to pass, repeated until
   the new tests pass.
3. Kill the specific mutation survivors that motivated the finding,
   following the fix-loop part of
   [references/mutation-testing.md](references/mutation-testing.md). Prove
   each kill in a throwaway copy, never in the running stack; where the
   tests only run against the running stack, show the kill by tracing the
   new assertion and say it was not run.
4. Freeze the new diff and re-review it from step 1 of the review flow, as
   one reviewer without sub-reviewers. A fix is a new change; it inherits no
   approval.
