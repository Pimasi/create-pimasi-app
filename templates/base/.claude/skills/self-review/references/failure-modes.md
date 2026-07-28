# Self-review failure modes and project checklist

Hypothesis prompts for reading your own diff. Report nothing that fails the
finding gate in step 5 of [SKILL.md](../SKILL.md).

## How sessions fool themselves

- **Phantom completion**: you remember creating a file, writing a test, or
  wiring a route that is absent or empty in the tree. Verify existence and
  content, not recollection.
- **Stale green**: a check passed earlier in the session, then you kept
  editing. The memory of "tests pass" survives the edits that broke them.
- **Hallucinated contract**: the API, option, or library feature you used does
  not exist in the pinned version. Verify against `node_modules` or the
  package's docs, not recall.
- **Partial propagation**: you changed a schema, type, or env var in one layer
  while a consumer (server handler, web hook, fixture, `docker-compose.yml`,
  README) still has the old shape.
- **Unwired code**: the new module exists but nothing imports, mounts, or
  registers it, or an existing path shadows it. Trace from the entry point to
  your code.
- **Happy-path bias**: validation, permissions, error propagation, cleanup, and
  duplicate or concurrent calls went unhandled because you built against the
  demo input.
- **Test theatre**: assertions restate the implementation, mocks replace the
  boundary under test, or the test cannot fail. Ask of each test: would it go
  red if my change were wrong?
- **Invented fallback**: a made-up default or a swallowed error converts
  failure into apparent success.
- **Scope drift**: opportunistic refactors, formatting churn, or dependency
  bumps nobody asked for.
- **Placeholder residue**: TODOs, sample values, debug logging, `.only` or
  skipped tests, commented-out code, leftover scratch files.
- **Environment assumption**: you validated against a stale container, an old
  build, or host-side state. Tests count only inside Docker here.
- **Self-anchoring**: re-reading your own code convinces you it is right
  because you remember the intent. Read what it does, not what it meant.

## Project checklist

Check every item whose surface you touched. Each is a convention from the
project README; the README section is authoritative when in doubt.

- **Endpoints ship with tests**: every new or changed `*.route.ts` has a
  matching `*.test.ts` in the same commit, covering success AND error cases
  (auth, validation), with side effects asserted via `$test.db.*`.
- **HTTP through `@pimasi/utils/lib/http` only**: `$server` in the web app,
  the `$test` helpers in server tests. No raw `fetch` or `axios` anywhere,
  tests included.
- **Schemas via `@pimasi/utils`**: `Schema` from `lib/json-schema`, placed in
  `@pimasi/lib` when shared on the wire; never Zod or ajv. Server validation
  and web types updated together.
- **Data access behind the repository interface**: handlers talk to the model
  file's repo, never to the database driver directly.
- **Auth tokens via the `token-storage` module**: never read or write
  `localStorage` directly for tokens.
- **Semantic colour tokens only**: `bg-primary`, `text-muted-foreground`, and
  friends; no hardcoded palette classes (`bg-purple-600`) or hex values; hover
  states via opacity modifiers (`/90`), never invented `-hover` tokens.
- **New env vars threaded end to end**: the server's env validation
  (`apps/server/src/env.ts`), `.env.example`, `docker-compose.yml`, and the
  README; `VITE_*` / `NEXT_PUBLIC_*` vars also need the matching ARG in
  `Dockerfile.web`.
- **Timestamped artefacts**: migrations and ADRs named
  `YYYYMMDDHHMMSS-{kebab-description}`, prefix from `date +%Y%m%d%H%M%S`.
- **Docs in the same commit**: changes to structure, env, dev flow, build, or
  conventions update the README now, not as a follow-up ("Keep this README in
  sync").
- **No agent-authored comments**: you wrote none; only functional pragmas
  (`@ts-expect-error`, `prettier-ignore`, shebangs) are allowed from agents.
- **Docker-first test targets**: any new test target runs inside a container
  and is wired into `make test` or a sibling make target; no host-only test
  paths.
- **British English**: code and docs use it (behaviour, colour, initialise).
- **Optional features** (check the README's Stack section for what this
  project has): queue handlers idempotent under redelivery; websocket events
  defined in the shared event schema, not ad hoc; cache keys include every
  input that changes the value, with invalidation on the write path.
