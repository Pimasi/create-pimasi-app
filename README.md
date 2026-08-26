# create-pimasi-app

A `create-next-app`-style scaffolder that composes a full-stack TypeScript monorepo from template fragments. It wires up **auth, a shared Express API, a web frontend, and optional background workers** so a new PIMASI product starts with the plumbing already done.

## Usage

```bash
# interactive wizard
npm create pimasi-app@latest
# or
npx create-pimasi-app

# non-interactive (scriptable)
npx create-pimasi-app my-app --yes --frontend tanstack --db postgres --design shadcn

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

Eight stack combinations (frontend × database × design), each with Cordova and four server features optionally layered on:

- **Frontend**: `tanstack` (React 19 + Vite + TanStack Router SPA) or `nextjs` (Next.js App Router, a client of the Express API).
- **Database**: `mongo` (MongoDB driver) or `postgres` (Kysely over `pg`). The choice swaps only the server's data-access layer behind a repository interface.
- **Design**: `shadcn` (shadcn/ui — standard tokens, light+dark, `components.json`) or `bespoke` (in-house dark palette, zero extra deps). Both implement the same component API and token vocabulary, so pages are written once; the choice swaps only `apps/web`'s theme CSS and `components/ui/*`.
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

The CLI then **generates** `docker-compose.yml`, `.env.example`, and a `## Stack` block in the project `README.md` from the selections, and finally replaces the `__APP_SLUG__` placeholder plus the workspace and container names across all text files (`@pimasi/lib` → `@<name>/lib`, `pimasi-server` → `<name>-server`, `pimasi-web` → `<name>-web`, `pimasi-mongo`/`pimasi-redis`/`pimasi-postgres` → `<name>-mongo`/`<name>-redis`/`<name>-postgres`; `@pimasi/utils` stays as-is). It records the selections in a **`pimasi.json` manifest** and injects itself as a devDependency, which is what powers add mode later.

## Adding features to an existing project

The package ships a second bin, `pimasi`, for projects already scaffolded (it reads `pimasi.json`):

```bash
npx pimasi add websockets        # or: workers, cache, rate-limit — several at once is fine
npx pimasi add                   # interactive: pick from the features currently off
```

An add re-runs template composition for just the delta (pulling Redis in when the first Redis-needing feature arrives) and updates `docker-compose.yml`, `.env.example`, and the README stack block. It refuses to run on a dirty git tree so every add is reviewable with `git diff`. Files you have edited are never clobbered: the CLI writes `<file>.new` next to them and reports; `package.json` merges never downgrade a dependency you bumped. Frontend, database, and design are scaffold-time choices — `add` covers the server features only.

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

Source lives in `src/`: `index.ts` (prompts + flags + orchestration), `add.ts` (add mode), `compose.ts` (recursive copy, deep-merge, placeholders), `generate.ts` (docker-compose / env / README / `pimasi.json` generators), `templates.ts` (locate `templates/`), and `types.ts`. The `templates/` directory is resolved by walking up from the running module until a directory containing both `templates/` and `DESIGN.md` is found, so it works from `dist/`, from `tsx src/`, and from a generated project's `node_modules`.

One release-ordering caveat: scaffolds inject the running CLI version as a devDependency of the generated project, so `npm install` there only resolves once that version is published. When testing from source, pass `--no-install` or point the generated project at your checkout: `npm pkg set devDependencies.create-pimasi-app=file:<path-to-repo>`.
