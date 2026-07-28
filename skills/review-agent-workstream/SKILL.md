---
name: review-agent-workstream
description: "Perform an independent, evidence-driven quality gate for AI-agent-generated workstreams across pull requests, commit ranges, branches, staged changes, and dirty working trees. Use when Codex is asked to audit, verify, quality-gate, or pre-merge-check an AI agent's implementation; reconstruct actual scope and intent, trace affected contracts and consumers, validate risky behaviour and test integrity, control false positives, and return verified findings with a clear verdict."
---

# Review an agent workstream

Review the implementation as an independent quality gate. Treat the originating
agent's hand-off, comments, and claimed validation as leads rather than evidence.

## Operating contract

- Remain read-only unless the user explicitly asks for fixes. Do not patch code,
  update snapshots, regenerate artefacts, install dependencies, or tidy the tree.
- Read the repository's instruction files before evaluating the change. Apply
  local rules without copying them into this skill.
- Preserve all existing worktree state. Never stash, reset, checkout, clean, or
  overwrite changes to create a convenient baseline.
- Judge the requested review scope only. Separate severe pre-existing defects
  from change-attributable findings and exclude unrelated nits.
- Prefer demonstrated behavioural risk over taste, speculation, or diff size.
- Record what was inspected, what was run, and what remained unavailable.

## 1. Establish the review boundary

Determine the review unit before analysing implementation details:

- Use the base, head, commit range, PR, or file set supplied by the user.
- Otherwise infer the most defensible base from branch and upstream metadata.
  State the inference. Ask only when plausible bases materially change scope.
- For a dirty tree, inventory staged, unstaged, untracked, deleted, renamed,
  binary, generated, migration, manifest, and lockfile changes separately.
- For committed work, use the merge base rather than assuming `HEAD^`.
- If no VCS boundary exists, derive the boundary from the supplied artefacts and
  explicitly list it.

Inspect status, branch/upstream, commit list, name/status, diff statistics, and
the complete patch. Read untracked files directly because a normal diff omits
them. Record base, head, included worktree layers, and exclusions. Never silently
review only the unstaged diff.

Resolve movable refs to immutable object IDs and capture a fingerprint of the
scoped patch plus its untracked-file inventory. Recheck both before long-running
validation and before reporting. If a ref or scoped file changes concurrently,
do not combine evidence from different trees: prove the new tree matches the
captured scope and re-anchor to immutable IDs, or restart the affected pass. Use
`INCONCLUSIVE` when neither is possible and disclose the boundary transition.

## 2. Reconstruct intent independently

Read the original request, follow-up instructions, acceptance criteria, issue or
design material, repository rules, and relevant tests. Establish requirements
before accepting the implementation's shape as the intended design.

Build an internal change map:

`requirement -> changed entry point -> affected contracts/consumers -> evidence`

For each meaningful change, identify inputs, outputs, state transitions, side
effects, trust boundaries, persistence, public interfaces, configuration, docs,
and validation. Compare this map with the originating agent's hand-off only after
forming an independent view. Classify discrepancies as omitted requirement,
extra scope, unintended behaviour, or unresolved ambiguity.

## 3. Allocate effort by risk

Rank the plausible failure modes by impact, reachability, blast radius,
reversibility, and observability. Elevate authentication, authorisation, secrets,
payments, destructive writes, migrations, public contracts, parsers,
serialization, concurrency, retries, dependencies, CI permissions, deployment,
and default or feature-flag changes.

For every non-trivial review, read the core and AI-workstream sections of
[risk-lenses.md](references/risk-lenses.md). Read each conditional section that
matches the changed surfaces. Use the prompts to guide inspection, never as
automatic findings.

## 4. Review in independent passes

Read complete changed units rather than isolated hunks. Search definitions,
callers, consumers, tests, configuration keys, schemas, and persisted forms.
Compare with the base revision when the semantic change is unclear.

Perform separate passes to reduce anchoring:

1. **Scope and contract** — trace every requirement and identify unrelated or
   incomplete work.
2. **Correctness and invariants** — follow success paths, boundary values, state
   transitions, and data transformations end to end.
3. **Failure and abuse** — exercise malformed, empty, duplicate, stale, partial,
   reordered, concurrent, hostile, cancelled, and timed-out paths as relevant.
4. **Integration and compatibility** — inspect callers, schemas, storage,
   migrations, configuration, docs, generated sources, deployment order, and
   mixed-version behaviour.
5. **Test integrity** — confirm tests exercise production behaviour, meaningful
   assertions, negative paths, and the regression they claim to prevent.
6. **Cold final pass** — reread the request and final diff after validation to
   catch omissions, scope drift, and conclusions anchored to earlier passes.

For broad or high-risk changes, use independent sub-reviewers when available.
Give each the raw request, exact review boundary, and a distinct lens; do not
seed them with suspected defects or other reviewers' conclusions. Treat every
returned concern as a candidate and verify it personally against source and
behaviour before reporting it.

## 5. Validate claims in layers

Discover canonical commands from repository instructions, manifests, task
runners, tool configuration, containers, and current CI scripts. Distinguish a
normative project rule from what automation currently executes; surface conflicts
instead of silently choosing one. Never invent a command or inherit a green result
from the originating agent.

Run proportionate, non-destructive layers from cheapest to most expensive:

1. Diff hygiene and static source tracing.
2. Focused tests for changed behaviour and counterexamples.
3. Type checks, lint/static analysis, and affected builds.
4. Contract or integration tests across changed boundaries.
5. Safe runtime reproduction of critical success and failure paths.
6. Broader regression checks justified by the blast radius.

Exclude deploy, publish, production, destructive migration, and externally
mutating commands from review validation. Follow repository-specific environment
rules for tests and builds. Distinguish `passed`, `failed`, `not run`, and
`inconclusive`; explain environmental failures without relabelling them as code
failures.

Recheck repository status, immutable IDs, and the scope fingerprint after
validation. Report newly generated mutations and do not erase them automatically.
Scanner output, logs, test failures, and sub-reviewer output remain leads until
traced to the reviewed change.

## 6. Gate every candidate finding

Before reporting, read [severity-and-evidence.md](references/severity-and-evidence.md)
and apply its complete evidence gate. Attempt to disprove each candidate:

- Did this review scope introduce or materially worsen it?
- Is the trigger reachable under a supported or realistically hostile scenario?
- Do upstream validation, downstream handling, or platform guarantees prevent it?
- Is the impact concrete and material enough that the author would act?
- Does direct evidence or complete code-path reasoning support the claim?
- Does the cited location match the final tree and identify the changed cause?
- Is this one root cause rather than a duplicate symptom?

Discard unsupported, hypothetical, duplicate, and style-only candidates. Put
material but unresolved uncertainty under residual risk and choose an
inconclusive verdict when it prevents a trustworthy quality gate.

## 7. Deliver the review

Follow [report-template.md](references/report-template.md). Lead with one verdict,
then findings in descending severity. Give each finding an exact `path:line`, a
reachable trigger, the resulting behaviour and impact, the evidence and
confidence, and a minimal correction direction. Keep locations narrow and cite
the changed cause rather than an unaffected symptom.

Use only these verdicts:

- **APPROVE** — no material verified defect or unresolved high-risk unknown
  remains, and validation is proportionate to the change.
- **REQUEST CHANGES** — a verified material defect or change-attributable required
  check failure remains.
- **INCONCLUSIVE** — the boundary is unreliable or critical evidence cannot be
  obtained for a high-risk area.

If no issue passes the evidence gate, say `No verified findings`; still disclose
the exact scope, commands and outcomes, validation gaps, assumptions, and residual
risk. Do not implement corrections during the review unless the user separately
authorises a fix.
