# create-pimasi-app

A `create-next-app`-style scaffolder that composes a full-stack TypeScript monorepo from template fragments. It wires up **auth, a shared Express API, a web frontend, and optional background workers** so a new PIMASI product starts with the plumbing already done.

## Usage

```bash
# interactive wizard
npm create pimasi-app@latest
# or
npx create-pimasi-app

# non-interactive (scriptable)
npx create-pimasi-app my-app --yes --frontend tanstack --db postgres --design shadcn --ci github

# later, inside a generated project: add server features
npx pimasi add websockets
```

The first positional argument is the app name; `--name` overrides it. The name is wired through the whole project: it becomes the root `package.json` name **and the package scope**, so an app named `acme` has workspaces `@acme/lib`, `acme-server`, `acme-web` and its code imports `@acme/lib/schemas/...`. (The external `@pimasi/utils` dependency is never renamed.)

## Options

| Flag                               | Values                 | Default         | Purpose                                                                                                 |
| ---------------------------------- | ---------------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| `--name <slug>`                    | kebab-case             | `my-pimasi-app` | App name (also the first positional); becomes the package scope `@<name>/lib`                           |
| `--dir <path>`                     | path                   | `./<name>`      | Target directory (must be empty unless `--force`)                                                       |
| `--frontend <f>`                   | `tanstack` \| `nextjs` | `tanstack`      | Web app framework                                                                                       |
| `--db <d>`                         | `mongo` \| `postgres`  | `mongo`         | Data layer (`postgres` uses Kysely)                                                                     |
| `--design <d>`                     | `shadcn` \| `bespoke`  | `shadcn`        | Design system for `apps/web`                                                                            |
| `--ci <host>` | `github` \| `gitlab` \| `none` | `none` | CI gate, manual releases and release notes |
| `--maintainers-only` / `--no-maintainers-only` | on \| off | on with a host | Answers "Only Maintainers can release?"; on GitHub, promotions then need `RELEASE_TOKEN` on each environment (see the generated `RELEASE.md`) |
| `--cordova` / `--no-cordova`       | —                      | off             | Mobile packaging of the web app                                                                         |
| `--workers` / `--no-workers`       | —                      | off             | BullMQ queues + a dedicated workers process                                                             |
| `--cache` / `--no-cache`           | —                      | on              | Redis-backed `$cache` service                                                                           |
| `--rate-limit` / `--no-rate-limit` | —                      | on              | Redis-backed rate limiting on the auth routes                                                           |
| `--websockets` / `--no-websockets` | —                      | off             | Realtime WebSocket push over the `$bus` seam (pulls Redis in; ships client hooks for the chosen frontend) |
| `--yes`, `-y`                      | —                      | —               | Skip prompts; use flags + defaults                                                                      |
| `--no-install`                     | —                      | —               | Skip `npm install`                                                                                      |
| `--no-git`                         | —                      | —               | Skip `git init`                                                                                         |
| `--force`                          | —                      | —               | Allow a non-empty target directory                                                                      |

## Options matrix

Eight stack combinations (frontend × database × design), each with Cordova, four server features, and GitHub or GitLab CI and releases optionally layered on:

- **Frontend**: `tanstack` (React 19 + Vite + TanStack Router SPA) or `nextjs` (Next.js App Router, a client of the Express API).
- **Database**: `mongo` (MongoDB driver) or `postgres` (Kysely over `pg`). The choice swaps only the server's data-access layer behind a repository interface.
- **Design**: `shadcn` (shadcn/ui — standard tokens, light+dark, `components.json`) or `bespoke` (in-house dark palette, zero extra deps). Both implement the same component API and token vocabulary, so pages are written once; the choice swaps only `apps/web`'s theme CSS and `components/ui/*`.
- **CI and releases**: `github`, `gitlab`, or `none` (default). A host adds a request gate, manual promotion of a validated main commit, release notes and the generated `RELEASE.md` operator guide.
- **Cordova**: adds an `apps/web/cordova/` shell plus a `build:cordova` script for Android/iOS packaging.
- **Server features** — Redis (compose service + client) ships only when at least one is on:
  - `--workers` (default off): BullMQ queues, a workers process, and email dispatch via queues.
  - `--cache` (default on): the Redis-backed `$cache` service.
  - `--rate-limit` (default on): the Redis-backed `RATE_LIMIT` middleware protecting the auth routes (off swaps in a no-op middleware with the same API).
  - `--websockets` (default off): a JWT-authenticated `/ws` endpoint with cross-instance fan-out over `$bus` — the Redis-backed messaging seam with ephemeral broadcast channels plus durable channels with consumer groups — and a `WebSocketProvider` and hooks for the chosen frontend. The infrastructure ships unmounted — the generated README explains how to wire it into the app shell.

## How templates compose

Fragments live under `templates/` and are copied in order onto the target (disjoint paths, so nothing clobbers except `package.json`, which is deep-merged). One file is renamed on the way: npm strips every `.gitignore` from a published tarball, so templates store it as `_gitignore` and the CLI writes it as `.gitignore`.

1. `base/` — root tooling, `@pimasi/lib`, the Express server **framework**, the project guides (`README.md`, `CONTRIBUTING.md`, `AGENTS.md`, plus the `CLAUDE.md` / `.codex` / Copilot entry-point redirects), and the agents' `code-review` skill under `.claude/skills/` (always copied).
2. `db/<db>/` — the server data-access overlay (`db.ts`, repo impls, migrations, `env.ts`, test helpers) plus a `package.json` deps partial.
3. `server/*` — optional server-feature overlays onto `apps/server`, in order: `redis` (when cache, rate-limit, or websockets is on), `rate-limit`, `workers`, `cache`, then `websockets/server` (the `/ws` endpoint, the `$websocket` send service, `$bus`, and shared event schema).
4. `frontend/<frontend>/` — `apps/web` for the chosen framework, then `websockets/<frontend>/` when WebSockets is on (the web client, provider, and hooks).
5. `design/<design>/<frontend>/`, then `cordova/<frontend>/` when enabled — theme CSS and `components/ui/*`, the mobile shell, and their web `package.json` partials.
6. `ci/common/`, then `ci/<host>/` when selected: release scripts, Docker overrides, tests, `RELEASE.md`, and the host pipeline and adapter.

The CLI then **generates** `docker-compose.yml`, `.env.example`, and a `## Stack` block in the project `README.md` from the selections, and finally replaces the `__APP_SLUG__` placeholder plus the workspace and container names across all text files (`@pimasi/lib` → `@<name>/lib`, `pimasi-server` → `<name>-server`, `pimasi-web` → `<name>-web`, `pimasi-mongo`/`pimasi-redis`/`pimasi-postgres` → `<name>-mongo`/`<name>-redis`/`<name>-postgres`; `@pimasi/utils` stays as-is). It records the selections in a **`pimasi.json` manifest** and injects itself as a devDependency, which is what powers add mode later.

## Adding features to an existing project

The package ships a second bin, `pimasi`, for projects already scaffolded (it reads `pimasi.json`):

```bash
npx pimasi add websockets        # or: workers, cache, rate-limit — several at once is fine
npx pimasi add ci-github
npx pimasi add ci-gitlab
npx pimasi add ci-github --refresh
npx pimasi add                   # interactive: pick from the features currently off
```

An add re-runs template composition for just the delta (pulling Redis in when the first Redis-needing feature arrives) and updates `docker-compose.yml`, `.env.example`, and the README stack block. It refuses to run on a dirty git tree so every add is reviewable with `git diff`. Files you have edited are never clobbered: the CLI writes `<file>.new` next to them and reports; `package.json` merges never downgrade a dependency you bumped. Frontend, database, and design are scaffold-time choices — `add` covers the server features and one CI host. A host cannot be switched through add mode. Adding a host asks "Only Maintainers can release?" like the wizard, defaulting to yes; `--maintainers-only` or `--no-maintainers-only` answers it in `--yes` runs, and the answer goes to `scripts/release/config.sh`.

Apps scaffolded with 0.2.0 adopt CI with `npx create-pimasi-app@latest add ci-github` or `npx create-pimasi-app@latest add ci-gitlab`. The explicit latest package avoids the locally installed 0.2.0 CLI, whose `pimasi add` command does not support CI. Pristine files from that published release are upgraded in place, including the image and health-response prerequisites. Edited prerequisites get `.new` files and a "Merge before your first release" list; fragments are still added. Missing lockfiles and branches other than `main` are reported.

For an already selected host, `npx pimasi add ci-github --refresh` (or `ci-gitlab`) refreshes release tooling and pipelines, reports changed files, and records the current CLI version. It requires a clean git tree and preserves the project's `scripts/release/deploy.sh`, `scripts/release/config.sh` and `scripts/release/environments/`.

## Managing project environments

Projects with GitHub or GitLab CI start with production as their only environment. Define the others inside the project with either `npx pimasi env` or `npx create-pimasi-app env`:

```bash
npx pimasi env list
npx pimasi env add uat --publish --yes
npx pimasi env add dev --on-merge --yes
npx pimasi env remove dev --yes
```

Environments are independent by default, and no rule forces UAT before production. `--publish` makes the new environment create versions: deploying a commit to UAT tags it and creates its `release/<version>` branch, and production then reuses that version. `--before production` and `--after <environment>` stay opt-in: the first makes production wait for UAT's live record, the second makes the new environment wait for that target. Each environment has its own live record, notes baseline and `env/<name>` branch. The CLI copies the project's production build values as placeholders, disables publication for new environments unless `--publish` is given, and prints the files to edit, the deploy seam to connect and the host's promotion command. Production cannot be added or removed. See the generated `RELEASE.md` for the full contract.

`--on-merge` deploys the environment after the main push gate passes. The CLI also creates its host environment through an installed, signed-in `gh` or `glab`; if unavailable, it succeeds locally and the first promotion creates the host page. The list includes host status. Removal warns that host-side secrets go with the environment; `--yes` confirms, while `--keep-host` preserves it.

Names use lower-case letters, digits and dashes, start with a letter or digit, and have at most 32 characters. Without a name, or without `--yes` on a terminal, add prompts for a name, relation, deployment on merge and "Create a version when deployed here?" (default no); `--yes` never prompts. Environment commands require `pimasi.json`, a selected CI host and `production.env`, but allow a dirty git tree. The files under `scripts/release/environments/` define the environments and survive CI refreshes.

## Generated project conventions

The full rules ship in each generated project's `README.md`; the headlines:

- **Docker-first, make-driven dev**: `make` targets wrap docker compose (`make dev` boots the stack, `make test` runs every test inside the containers). Only type-check and formatters run on the host; prefer `make` over `npm run`.
- **Case by boundary**: `snake_case` only on external contracts (API fields, DB columns/document fields, queue payloads, JWT claims); everything internal is `camelCase`.
- **Timestamped generated content**: migrations and ADRs are named `YYYYMMDDHHMMSS-{kebab-description}` (14-digit, to the second), never sequential `0001` prefixes.
- **HTTP + validation via `@pimasi/utils` only** (`lib/http`, `lib/json-schema`): never `ajv`, `zod`, raw `fetch`, or `axios`, in app code and test helpers alike.
- **TypeScript + Prettier, never ESLint**: tsc is the correctness gate, prettier the style gate; `make update-deps` bumps every dependency to latest.

## Developing the CLI

```bash
npm install
npm run dev -- --yes --name demo --frontend tanstack --db mongo   # run from source (tsx)
npm run build                                                       # tsc -> dist/
npm start -- --help                                                # run the built bin
```

Run `npm test` from this repository's root on the host to build the CLI and run every `test/*.test.ts` regression, including environment commands, CI add and refresh, and readiness adoption. Set `TMPDIR` to a writable scratch directory for the disposable project fixtures. Generated app tests run inside Docker through `make test`.

Source lives in `src/`: `index.ts` (prompts + flags + orchestration), `add.ts` (add mode), `env.ts` (project environments), `compose.ts` (recursive copy, deep-merge, placeholders), `generate.ts` (docker-compose / env / README / `pimasi.json` generators), `templates.ts` (locate `templates/`), and `types.ts`. The `templates/` directory is resolved by walking up from the running module until a directory containing both `templates/` and `DESIGN.md` is found, so it works from `dist/`, from `tsx src/`, and from a generated project's `node_modules`.

One release-ordering caveat: scaffolds inject the running CLI version as a devDependency of the generated project, so `npm install` there only resolves once that version is published. When testing from source, build this checkout, scaffold with `node <repo>/dist/index.js ... --no-install`, keep the generated dependency at a published registry version, and run `npm install` in the app. Exercise add mode with `node <repo>/dist/index.js add ...`; an external `file:<repo>` dependency cannot be used by the Docker build context.
