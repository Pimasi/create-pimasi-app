# Differential mutation reference

Mutation testing seeds small defects (mutants) into the code and re-runs the
tests. A suite that never notices a mutant would not notice the equivalent
real bug. Differential (diff-based) mutation testing restricts mutation to
the code changed in the current diff, so runtime scales with the change
rather than the codebase.

Terms the reports use:

- **Killed**: at least one test failed under the mutant. The desired outcome.
- **Survivor**: every test passed under the mutant. A blind spot in the suite.
- **Uncovered site / no coverage**: no test even executes the mutated line.
  Report these separately from survivors; an unexecuted mutant can never be
  killed.
- **Equivalent mutant**: the mutation cannot change observable behavior (for
  example, a mutated internal counter that never reaches any output). Not
  killable. Record it and move on; do not distort the code to chase it.
- **Timeout**: the mutant sent execution into a loop. Most tools count it as
  killed.

## During review (read-only)

Process one module completely before starting the next:

1. Build the module's changed-file list from
   `git diff --name-only --diff-filter=AM base`.
2. Make a throwaway copy that can run the focused tests (the package, not
   one file). Never mutate the reviewed tree or anything the running stack
   loads.
3. Run the project's mutation tool scoped to those files, workers capped at 3. With no tool installed, do not add one during a review: hand-apply
   mutants one at a time (flip a comparison, drop a call, invert a
   condition), at most ten per module. Mutate first every behavior whose
   existing test the diff modified, re-pointed or deleted, and the code
   under each new test that passes on base; then the decision points the
   correctness pass ranked highest.
4. Record generated, killed, survivors, equivalents and uncovered sites,
   labelled tool or hand-applied. Give killed mutants as a count; name one
   only where a finding, its attribution to the change or its closure rests
   on it. A survivor on code the change did not add counts against the
   change only when the same mutant is killed at base.
5. Add no tests to the reviewed tree to kill survivors; that belongs to the
   fix loop. Remove the copy.

On a re-review of a fix diff, re-run only the mutants named in the accepted
findings. Start a new round only when the fix touches an elevated-risk
surface.

## In the fix loop

For each survivor or uncovered site an accepted finding names: open the
mutant's diff, identify the behavior boundary it crosses (a `>=` turned into
`>`, a dropped call, an inverted condition), and write the narrowest test
asserting the correct side of that boundary. Prefer strengthening an
existing assertion when a test already executes the line. Re-run until those
survivors are killed or recorded as equivalent.

## Tool commands

| Ecosystem | Tool      | Scope to the diff                                           | Cap workers at 3  |
| --------- | --------- | ----------------------------------------------------------- | ----------------- |
| JS/TS     | StrykerJS | `--mutate` with the changed-file globs, or incremental mode | `--concurrency 3` |

For any other stack: pick the ecosystem's maintained mutation tool, scope it
with its changed-files option, and use its worker-count flag. Verify flags
against the installed version before running; mutation tools rename options
between major releases.
