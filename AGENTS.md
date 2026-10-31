# AI agent guide

Rules for AI agents working on the create-pimasi-app repository. Agent entry
points such as [CLAUDE.md](CLAUDE.md) redirect here; keep behavioural rules in
this file rather than in the entry points.

## Public repository

This repository is public. Never write a person's name, quotes of what someone
said, or a record of who decided what and when. State settled rules as behaviour
in the document that owns them.

## String enums

The CLI's TypeScript in `src/` and `test/`, and every template fragment, follow
[String enums](templates/base/CONTRIBUTING.md#string-enums): a closed set of
string values is a string `enum`, and code compares, assigns and passes its
members, never raw strings. In the CLI, an enum used by several modules lives in
`src/types.ts`; otherwise it sits beside its first use. Member values are the
strings the CLI already reads and writes, so flags, `pimasi.json`, environment
files and generated projects do not change. Published snapshots under
`templates/legacy/` and the POSIX shell release tooling are exempt.
The CLI's copy of `wireValues` lives in `src/types.ts`.

## Reviewing changes

When asked to review or verify changes ("review your changes", "verify your
work", "check the diff", "pre-merge check"), follow the `code-review` skill at
[templates/base/.claude/skills/code-review/SKILL.md](templates/base/.claude/skills/code-review/SKILL.md),
not an ad-hoc read-through. The skill ships inside the template, so in this
repo follow the file directly (skill auto-discovery only picks it up when
working under `templates/base/`). It ends in an APPROVE / REQUEST CHANGES /
INCONCLUSIVE verdict and stays read-only; apply fixes only through its fix
loop, on request.

## Release tooling

Before changing anything under `templates/ci/`, the `--ci` axis,
`add ci-<host>` or `pimasi env` in `src/`, read
[docs/releases.md](docs/releases.md). It explains how releases work, the
rules in §3 that must not be undone, and how to test the shell tooling.

## Repository skills

The agent guides and skills that ship with every generated app live under
`templates/base/`. Skills in `templates/base/.claude/skills/` are discovered
automatically only when working on files under `templates/base/`; elsewhere in
this repo, follow the skill file directly as described above.

The review skill keeps the name `code-review`. In a generated app it takes
the place of Claude Code's bundled `/code-review`, so a typed `/code-review`,
and any review Claude routes to a skill, runs the gate; the bundled review
stays reachable as a typed `/review`.
