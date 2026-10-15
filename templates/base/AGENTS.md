# AI agent guide

Before changing the repository, read:

1. [README.md](README.md) for setup, architecture, and common commands.
2. [CONTRIBUTING.md](CONTRIBUTING.md) for code, testing, and documentation
   conventions that apply to every contributor.
3. This file for rules specific to AI agents.
4. [RELEASE.md](RELEASE.md), when present, before changing CI, releases or deployment.

Agent entry points such as [CLAUDE.md](CLAUDE.md), [.codex](.codex), and
[.github/copilot-instructions.md](.github/copilot-instructions.md) redirect
here so behavioural rules have one canonical home. Update `CONTRIBUTING.md`
when a rule should also apply to a human contributor; update this file only
for agent-specific behaviour.

## Clarify before deciding — ask, don't guess

**This is the single most important rule in this file.** A one-line question costs nothing; a wrong assumption costs a re-do. When a task has an ambiguous choice, a tradeoff worth flagging, an invented name/threshold/default, or ripple effects beyond its immediate scope, **stop and ask the user** before proceeding.

Moments that warrant a question, not a guess:

- Two reasonable implementations exist (collapse two endpoints vs. keep both; add a new route vs. modify an existing one).
- A change has ripple effects outside the immediate scope (deleting a public API, renaming a field on the wire, schema changes).
- The user's phrasing could reasonably mean more than one thing.
- You'd need to invent a name, threshold, default, or UX affordance that isn't obvious from context.
- You notice something odd or incorrect adjacent to the task (pre-existing bug, redundant field, dead code) — surface it and ask whether it's in scope, don't silently "fix" it.

Prefer: "I'm about to do X — or did you mean Y?" over guessing and explaining afterwards.

## No AI-authored comments in code — ever

**Agents never write comments, full stop. Comments are a human-only channel: they carry intent, a deliberate warning, or hard-won context that a person chose to leave for other people. Only users write them; if a comment is in the code, a human put it there on purpose.** Make the code self-explanatory through names and structure instead; when something genuinely needs explaining, put it in the commit/PR description or ask whether it warrants a (human) comment.

- Never narrate what the code does (`// loop over items`, `// increment the counter`), restate the next line, or sprinkle `// TODO` / `// NOTE` markers.
- Do not add or re-expand JSDoc / docblocks on code you touch unless the user explicitly asks for it.
- Do not delete or reword a human's existing comment as an incidental side effect of an unrelated edit — that context is theirs, not yours to tidy.
- **Functional / directive comments are exempt** — they are machine instructions, not prose: `// @ts-expect-error`, `// @ts-ignore`, `// eslint-disable*`, `// prettier-ignore`, `#!` shebangs, and similar pragmas stay, and you still add them when they are functionally required.

## No plan mode — plans live in `.scratch/`

**Do not use your tool's plan mode.** When a task needs a plan, write it as a markdown file under the gitignored `.scratch/` folder at the repo root, then validate it with the user before implementing. A plan file can be read, edited, and re-reviewed by anyone at any point; plan mode traps the same content inside one tool's session.

## Generated content follows the timestamp convention

**Anything you generate that is timestamped by name (migrations, ADRs, similar artefacts) is named `YYYYMMDDHHMMSS-{kebab-description}`**: run `date +%Y%m%d%H%M%S` for the prefix. See [ADR and migration naming](CONTRIBUTING.md#adr-and-migration-naming--yyyymmddhhmmss-kebab-description) in the contributor guide. Never sequential `0001` prefixes, never unix seconds.

## Reviewing work on request: follow the code-review skill

**When the user asks you to review, verify, check, or double-check work ("check your work", "review your changes", "are you sure it's done?"), or asks for a code review of a branch, PR, or commit range, follow [.claude/skills/code-review/SKILL.md](.claude/skills/code-review/SKILL.md) instead of improvising.** The review is read-only and ends in an `APPROVE` / `REQUEST CHANGES` / `INCONCLUSIVE` verdict; fixes go through the skill's fix loop, and only when the user asks for them. Claude Code discovers it as a skill automatically; other agents follow the file directly. In Claude Code this skill takes the place of the bundled review of the same name: `/code-review` and a plain-words review request both run this gate. The bundled diff review, with its own effort levels and flags, still runs under its other name, `/review` (for example `/review low`), and only when a person types it.

## Documentation ownership

Keep each document within its intended scope:

| Document          | Owns                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| `README.md`       | Onboarding, quick start, architecture, common commands, and navigation  |
| `CONTRIBUTING.md` | Code style, backend/frontend conventions, testing, and docs conventions |
| `AGENTS.md`       | Behaviour that applies specifically to AI agents                        |
| `RELEASE.md`      | CI, releases and deployment, when enabled                               |
| `docs/adr/`       | Architecture Decision Records                                           |

**When asked to add, update, or remove a rule, edit the owning document — never the agent entry-point files** (`CLAUDE.md`, `.codex`, `.github/copilot-instructions.md`), which stay as redirects. Update the owning document in the same change that makes it stale; the when-to-update detail lives in the contributor guide's [Documentation](CONTRIBUTING.md#documentation) section, and its requirements are not duplicated here.
