# CRAP and differential mutation reference

## The CRAP metric

CRAP (Change Risk Anti-Patterns) was defined by Alberto Savoia and Bob Evans
in 2007. It scores one method at a time:

```
CRAP(m) = comp(m)^2 * (1 - cov(m))^3 + comp(m)
```

- `comp(m)`: cyclomatic complexity of method `m`.
- `cov(m)`: fraction of the method exercised by automated tests, 0.0 to 1.0.
  The original definition uses basis-path coverage; branch or statement
  coverage of the method is an acceptable stand-in when that is all the
  tooling reports.

Complexity is charged quadratically and coverage discounts the charge
cubically. Tests, not confidence, buy the right to complexity.

### Worked examples against the 8-or-less gate

| comp | cov | CRAP | Verdict                                         |
| ---- | --- | ---- | ----------------------------------------------- |
| 2    | 0.0 | 6.0  | Passes. Trivial code may go untested.           |
| 3    | 0.0 | 12.0 | Fails. Complexity 3 with no tests.              |
| 5    | 0.8 | 5.2  | Passes.                                         |
| 8    | 1.0 | 8.0  | Passes. The ceiling for fully tested code.      |
| 10   | 1.0 | 10.0 | Fails. No coverage level excuses complexity 10. |

Consequences: an untested method passes only up to complexity 2, a fully
tested method only up to complexity 8. Between those bounds, mix the two
levers: simplify the code, add unit tests, or both.

### Getting the score per ecosystem

- **PHP**: PHPUnit coverage reports (`--coverage-html`) include a per-method
  CRAP column out of the box.
- **Java**: JaCoCo's XML report carries a per-method `COMPLEXITY` counter with
  `missed` and `covered` parts; `comp = missed + covered` and
  `cov = covered / comp`.
- **Python**: take `comp` from `radon cc -j`, per-line coverage from
  `coverage json`, and join the two per function.
- **JavaScript/TypeScript**: take `comp` from ESLint's `complexity` rule (set
  `max` to 0 so it reports every function's number) and per-function coverage
  from istanbul/c8 (`coverage-final.json`), then join per function.
- **Anything else**: any complexity report plus any per-function coverage
  report, joined by a short throwaway script, is enough. The formula is one
  line; do not add a dependency just to compute it.

## Differential mutation testing

Mutation testing seeds small defects (mutants) into the code and re-runs the
tests. A suite that never notices a mutant would not notice the equivalent
real bug. Differential (diff-based) mutation testing restricts mutation to
the code changed in the current diff, so runtime scales with the change
rather than the codebase.

Terms the reports use:

- **Killed**: at least one test failed under the mutant. The desired outcome.
- **Survivor**: every test passed under the mutant. A blind spot in the suite.
- **Uncovered site / no coverage**: no test even executes the mutated line.
  Fix these before judging survivors; an unexecuted mutant can never be
  killed.
- **Equivalent mutant**: the mutation cannot change observable behavior (for
  example, a mutated internal counter that never reaches any output). Not
  killable. Record it and move on; do not distort the code to chase it.
- **Timeout**: the mutant sent execution into a loop. Most tools count it as
  killed.

### Per-module procedure

Process one module completely before starting the next, so each test-writing
session works against a single module's report:

1. Build the module's changed-file list from
   `git diff --name-only --diff-filter=AM base`.
2. Run the mutation tool scoped to those files, workers capped at 3.
3. Add covering tests for every uncovered site, then re-run.
4. Kill survivors: open the mutant's diff in the report, identify the behavior
   boundary it crosses (a `>=` turned into `>`, a dropped call, an inverted
   condition), and write the narrowest test asserting the correct side of that
   boundary. Prefer strengthening an existing assertion when a test already
   executes the line.
5. Re-run until killed plus recorded equivalents account for every generated
   mutant, then move to the next module.

### Tool commands

| Ecosystem | Tool          | Scope to the diff                                                | Cap workers at 3                                                                   |
| --------- | ------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| JS/TS     | StrykerJS     | `--mutate` with the changed-file globs, or incremental mode      | `--concurrency 3`                                                                  |
| Java      | PIT           | `mvn pitest:scmMutationCoverage` (locally modified classes only) | `-Dthreads=3`                                                                      |
| Python    | mutmut        | `mutmut run --paths-to-mutate src/module.py`                     | Serial by default; if the installed version has a parallelism setting, set it to 3 |
| PHP       | Infection     | `--git-diff-filter=AM` (files added/modified against the base)   | `--threads=3`                                                                      |
| Rust      | cargo-mutants | `git diff base > d.diff` then `--in-diff d.diff`                 | `--jobs 3`                                                                         |

For any other stack: pick the ecosystem's maintained mutation tool, scope it
with its changed-files option, and use its worker-count flag. Verify flags
against the installed version before running; mutation tools rename options
between major releases.
