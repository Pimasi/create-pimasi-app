# create-pimasi-app — DESIGN / CONTRACT

`create-pimasi-app` is a `create-next-app`-style scaffolder. It prompts the user, then composes a full-stack TypeScript monorepo from **template fragments** under `templates/`.

The fragments themselves are the source of truth for code; this document is the contract they must honour — the prompt matrix, the composition rules, the locked cross-fragment interfaces, and the conventions. When a fragment and this document disagree, fix one of them in the same change.

## The prompts

1. **Frontend** — `tanstack` (React 19 + Vite + TanStack Router SPA) or `nextjs` (Next.js App Router, **frontend only** — it is a client of the Express API, NOT full-stack Next).
2. **Cordova** — yes/no (mobile packaging of the web app).
3. **Database** — `mongo` (MongoDB driver) or `postgres` (**Kysely** query builder over `pg`).
4. **Workers** — yes/no, `--yes` default **no**: BullMQ queues + a separate workers process; email dispatch enqueues instead of sending inline.
5. **Cache** — yes/no, `--yes` default **yes**: a `$cache` service (`get`/`set`/`del`/`getOrSet`) on Redis.
6. **Rate limiting** — yes/no, `--yes` default **yes**: the Redis-backed `RATE_LIMIT` middleware replaces base's no-op.
7. **Design system** — `shadcn` (shadcn/ui conventions: stock zinc light+dark theme, cva/clsx/tailwind-merge, `components.json`) or `bespoke` (an in-house dark palette, zero extra deps). See "LOCKED design-system contract" below.

Redis is not a prompt — it ships exactly when something needs it. The `server/redis` fragment (the node-redis `$redis` client) composes when cache OR rate limiting is on; workers carries its own connection (`bullmq` embeds `ioredis`) and needs only `REDIS_URL`. `REDIS_URL` is required at runtime when ANY of the three server axes is on; with all three off the project has no Redis at all.

The Express **server is shared** across both frontends. The database choice swaps only the server's data-access layer, behind a repository interface — the auth + widget handlers never see the driver. The design choice swaps only `apps/web`'s theme CSS + `components/ui/*` implementations, behind a shared component API and token vocabulary — pages are written once. The three server axes compose through **seam files**: base ships a working redis-free implementation of a single file behind a stable exported API, and the fragment overwrites just that file (no-op → Redis `RATE_LIMIT`; direct-send → enqueueing `handlers/email/dispatch.ts`).

## Composition model

```
templates/
  base/                     # copied ALWAYS (root tooling, shared/lib, server FRAMEWORK)
  frontend/tanstack/        # -> apps/web (+ Dockerfile.web)   [React/Vite SPA]
  frontend/nextjs/          # -> apps/web (+ Dockerfile.web)   [Next.js app]
  db/mongo/                 # server DB overlay + mongo/ + Dockerfile.mongo
  db/postgres/              # server DB overlay (Kysely)
  server/redis/             # $redis node-redis client         [copied when cache OR rate limiting]
  server/workers/           # BullMQ queues + workers process  [copied when workers]
  server/cache/             # $cache service over $redis       [copied when cache]
  server/rate-limit/        # Redis-backed RATE_LIMIT seam     [copied when rate limiting]
  design/shadcn/tanstack/   # theme CSS + components/ui + cn + components.json + pkg partial
  design/shadcn/nextjs/     #   (same, Next file layout)
  design/bespoke/tanstack/  # in-house palette under the SAME token names + simple components
  design/bespoke/nextjs/    #   (same, Next file layout)
  cordova/tanstack/         # cordova shell + web package.json partial (build:cordova)
  cordova/nextjs/           # cordova shell + next static-export config
```

UI primitives live inside `apps/web` (supplied by the design overlay) — there is deliberately no shared UI package.

CLI compose order (later copies overlay earlier; paths are disjoint — no clobber — except package.json, which is MERGED, and the seam files the server fragments deliberately overwrite):

1. copy `base/` → target
2. copy `db/<db>/` → target
3. server fragments, each conditional: `server/redis/` if cache OR rate limiting; `server/workers/` if workers; `server/cache/` if cache; `server/rate-limit/` if rate limiting
4. copy `frontend/<frontend>/` → target
5. copy `design/<design>/<frontend>/` → target
6. if cordova: copy `cordova/<frontend>/` → target
7. **merge** `apps/server/package.json` = deepMerge(base, db partial, selected server-fragment partials); **merge** `apps/web/package.json` = deepMerge(frontend, design partial, cordova partial if selected)
8. **generate** `docker-compose.yml`, `.env.example`, and a "## Stack" block in `README.md` from the selections (CLI code, not template files)
9. **placeholder replace + workspace rename** across all text files
10. `git init` (+ optional `npm install`)

### Placeholders and the per-project workspace rename

- `__APP_SLUG__` — kebab app name. Appears in: root `package.json` "name", `apps/web/cordova/config.xml` (id `com.__APP_SLUG__.app` + name), README H1, the cordova shell package name.
- **Templates keep literal workspace and container names** so the template sources stay valid, greppable code. At generate time the CLI renames them by exact-token replacement using the app name:
  - `@pimasi/lib` → `@<slug>/lib` (package name, every import, tsconfig paths, transpilePackages)
  - `pimasi-server` → `<slug>-server`, `pimasi-web` → `<slug>-web` (package names, turbo filters, Dockerfile workspace flags, Makefile)
  - `pimasi-mongo` → `<slug>-mongo`, `pimasi-redis` → `<slug>-redis`, `pimasi-postgres` → `<slug>-postgres` (container names in Makefile/seeds.mk; the compose generator emits the renamed names directly)
  - `pimasi_auth_token` → `<slug_with_underscores>_auth_token` (web localStorage key)

  So an app named `acme` imports `@acme/lib/schemas/...`.
- **Never rename `@pimasi/utils`** (external published dep). The exact-token needles above cannot match it — never add a bare `pimasi` or `@pimasi/` needle.
- **`templates/` is prettier-ignored in this repo** (`.prettierignore`): markdown formatting mangles `__APP_SLUG__` in headings into `**APP_SLUG**`, which silently breaks the rename.

## LOCKED design-system contract

Both design overlays implement the SAME component API and the SAME token vocabulary (shadcn/ui's), so frontend pages are written once and never fork per design.

### Component API (identical import paths + props in both designs, both frontends)

- `@/components/ui/button` → `export function Button(props)` — extends `React.ButtonHTMLAttributes<HTMLButtonElement>` with `variant?: "default" | "secondary" | "outline" | "ghost" | "destructive" | "link"` and `size?: "default" | "sm" | "lg" | "icon"`. (shadcn overlay: the stock cva-based button, also exports `buttonVariants`.)
- `@/components/ui/input` → `export function Input(props)` — extends input attrs. MUST hide native number spinners (`[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`).
- `@/components/ui/spinner` → `export function Spinner({ className? })` — a small animated loading indicator.
- `@/lib/utils` → `export function cn(...inputs)` — shadcn overlay: `clsx` + `tailwind-merge`; bespoke overlay: `inputs.filter(Boolean).join(" ")` with no deps.
- The FRONTEND template (not the design overlay) owns `@/components/loading-page` — a full-page centred loader built on `Spinner` — because it is identical across designs.

For tanstack, `@/` maps to `./src/`; the design overlay ships `src/components/ui/*`, `src/lib/utils.ts`, and `src/styles.css` (the Tailwind entry: `@import "tailwindcss"`, theme tokens, `@source`). For nextjs, `@/` maps to the app root; the overlay ships `components/ui/*`, `lib/utils.ts`, and `app/globals.css`. The frontend template does NOT ship these files — the overlay always provides them.

### Token vocabulary (pages may use ONLY these + plain Tailwind utilities)

shadcn/ui v4 standard names: `background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`, `accent-foreground`, `destructive`, `border`, `input`, `ring`, plus `--radius`. One PIMASI extension both overlays must define: `success` (+ `success-foreground`).

- Hover states via opacity modifiers (`hover:bg-primary/90`), NOT `-hover` token variants.
- shadcn overlay: stock zinc theme, light `:root` + dark `.dark` via `@custom-variant dark (&:is(.dark *))` + `@theme inline`, oklch values, per current shadcn/ui Tailwind v4 conventions; ships `components.json` so `npx shadcn add <component>` works in generated projects.
- bespoke overlay: the PIMASI indigo/slate palette under these SAME standard names (`background` #0b0e14, `card` #151a23, `muted-foreground` #9aa4b2, `primary` #6366f1 with `primary-foreground` #ffffff, `border`/`input` #2a3140, `ring` #6366f1), dark-only (`:root` holds the dark values).
- shadcn overlay web package.json PARTIAL adds: `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`. Bespoke adds nothing.

## LOCKED repository interface (the DB abstraction)

The base server code depends ONLY on the surface below. **Base ships NO `models/` directory** — the DB overlay owns `apps/server/src/models/users.ts` and `models/widgets.ts` outright, and each file is self-contained: domain type + `*Repo` interface + the concrete `$users`/`$widgets` implementation for that database, together in one file. Both overlays must export the identical surface so base handlers compile against either.

```ts
// @pimasi/lib/values/auth  -> enum UserRoles { ADMIN="admin", USER="user" }

export interface UserModel {
    id: string;
    created_at: Date;
    name: string;
    email: string;              // normalised lowercase
    email_verified: boolean;
    password_hash?: string;     // undefined when unset
    firebase_id?: string;       // undefined when unset
    disabled_at?: Date | null;
    roles: UserRoles[];
}

export interface UsersRepo {
    findById(id: string): Promise<UserModel | null>;
    findByEmail(email: string): Promise<UserModel | null>;               // email pre-normalised by caller
    findByFirebaseOrEmail(firebaseId: string, email: string): Promise<UserModel | null>;
    insert(user: UserModel): Promise<void>;
    update(id: string, changes: Partial<UserModel>): Promise<void>;      // $set semantics; only provided keys change
}

export interface WidgetModel {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    quantity: number;
    created_at: Date;
    updated_at: Date;
}

export interface WidgetUpdate {
    name?: string;
    description?: string | null;
    quantity?: number;
    updated_at: Date;
}

export interface WidgetsRepo {
    listByUser(userId: string): Promise<WidgetModel[]>;                  // created_at DESC
    findByIdForUser(id: string, userId: string): Promise<WidgetModel | null>;
    insert(widget: WidgetModel): Promise<void>;
    updateForUser(id: string, userId: string, changes: WidgetUpdate): Promise<WidgetModel | null>; // updated row or null
    deleteForUser(id: string, userId: string): Promise<boolean>;         // true if a row was deleted
}
```

### Overlay model-file shape (single file: type + interface + implementation)

```ts
import { UserRoles } from "@pimasi/lib/values/auth";
import { $mongo } from "../services/db";   // or { $db, Database } in the Kysely overlay
export interface UserModel { ... }          // as above
export interface UsersRepo { ... }          // as above
export const $users: UsersRepo = { ...concrete driver implementation... };
export function normaliseEmail(email: string): string { return email.trim().toLowerCase(); }
```

`models/widgets.ts` mirrors this: exports `WidgetModel`, `WidgetUpdate`, `WidgetsRepo`, the concrete `export const $widgets: WidgetsRepo = { ... }`, and `toWidgetResponse(model): Widget` (Dates → `.toISOString()`, drop `user_id`; `Widget` type from `@pimasi/lib/schemas/api/widget.schema`). The interface blocks are duplicated verbatim between the two DB overlays — keep them in sync with the contract above; only one overlay ships per generated project.

### Behavioural contracts the handlers rely on

- `parse-session` loads the user via `findById` and deletes `password_hash` from the object before storing it in the ALS session — the hash never sits in request context.
- `get-session-user` re-fetches via `findById` to surface `password_hash ?? ""` (the web app branches set-password vs change-password on it).
- Widget mutations build a `WidgetUpdate` from the validated body plus `updated_at: new Date()`; `deleteForUser`'s boolean drives the 404.
- `backend.ts` imports `{ runMigrations } from "./migrations"` — the DB overlay owns that module.
- Password-reset tokens are **stateless** — no server-side token store. `handlers/auth/password-reset-token.ts` signs a JWT with `$env.JWT_SECRET` (~1 h expiry, via `jsonwebtoken`) carrying `{ type: "password_reset", user_id, pwd }`, where `pwd` is the first 16 hex chars of `sha256(password_hash ?? "")`. Verification checks the type, the expiry, and that `pwd` still matches the user's current `password_hash` — completing a reset changes the hash, so the token cannot be replayed (single-use without state). This implementation ships always; no fragment overwrites it.

## Fragment inventory

### base/ (always copied)

- Root: `package.json` (name `__APP_SLUG__`, `packageManager` pinned to npm, workspaces `["apps/web","apps/server","apps/shared/lib"]`, scripts build/type-check/cordova:build/prepare, husky/lint-staged/prettier/turbo devDeps), `turbo.json`, `Makefile` (the dev interface: setup/dev/dev-clean/test/type-check/format/update-deps, ends with `-include *.mk`), `.prettierrc`, `.prettierignore`, `.gitignore` (includes `.scratch/`), `.dockerignore`, `.husky/pre-commit`, `CLAUDE.md`, `.codex`, `.github/copilot-instructions.md`, `README.md` (the generated project's rulebook; CLI injects a Stack block), `Dockerfile.server`.
- `apps/shared/lib/**` — `@pimasi/lib`: API schemas (`schemas/api/*.schema.ts` via `@pimasi/utils` Schema) + shared values (`values/auth.ts` UserRoles).
- `apps/server/` framework: `src/app/**` (http-server, route factory, swagger, session ALS, cli-command, Migration factory), `src/middleware/**`, `src/utils/**` except `env.ts`, `src/services/**` except `db.ts`, `src/handlers/**` (auth, user, email, ping, widget — all against the repo interface), `src/backend.ts`, `cli.ts`, `process.config.js` (backend process only), `src/test/helpers.ts` (http via `@pimasi/utils/lib/http` + `$test` assembly; imports `seedUser`/`db`/`teardownSeed`/`cleanup` from `./db-helpers`) + `setup.ts`, `package.json` (common server deps — no DB driver, no Redis, no BullMQ), tsconfigs, `vitest.config.ts`.
- Base is **redis-free**. It ships working no-Redis implementations of the seam files the server fragments target:
    - `src/middleware/rate-limit.ts` — a no-op `RATE_LIMIT(opts): RequestHandler` that calls `next()`, exporting the same `RateLimitKey` type and `RateLimitOptions` interface as the Redis version, so the six auth call sites type-check untouched either way.
    - `src/handlers/email/dispatch.ts` — `dispatchLoginEmail(...)` / `dispatchResetPasswordEmail(...)` directly await the senders in `handlers/email/login-email.ts` + `reset-password-email.ts`. Routes call ONLY the dispatch functions, never the senders or queues.
    - `src/handlers/auth/password-reset-token.ts` — the stateless JWT reset token bound to the current `password_hash` (see Behavioural contracts). Not a fragment seam: this version ships always.
- Base intentionally references overlay-supplied modules that do not exist inside `templates/base/` alone: `services/db.ts`, `utils/env.ts`, `models/*`, `migrations/index.ts`, `test/db-helpers.ts`. Every fragment combination provides them; the composed project always compiles. The server fragments add nothing to this list — their new modules (`services/redis.ts`, `services/cache.ts`, `services/bull.ts`, the queues, `workers.ts`) are additive and unreferenced by base; their remaining files overwrite seams base already ships.

### db/mongo/ (overlay)

- `apps/server/src/services/db.ts` — `$mongo` from `MongoClient($env.MONGO_URL).db($env.MONGO_DATABASE)`.
- `apps/server/src/models/users.ts` + `models/widgets.ts` — the complete single-file models backed by `$mongo.collection(...)` (reads strip `_id` via projection; `updateForUser` uses `findOneAndUpdate` with `returnDocument: "after"`).
- `apps/server/src/migrations/index.ts` — Mongo-advisory-lock `runMigrations()` + one concrete `YYYYMMDDHHMMSS-create-initial-indexes.ts` (users unique `{email}`, widgets `{user_id, created_at:-1}`).
- `apps/server/src/utils/env.ts` — common env + `MONGO_URL`/`MONGO_DATABASE` (getenv).
- `apps/server/src/test/db-helpers.ts` — Mongo seeding/handles/teardown/cleanup.
- `apps/server/package.json` — PARTIAL adding the `mongodb` driver.
- `mongo/**` (replica-set entrypoint + dump/restore scripts), `seeds.mk` (mongo-seeds-save/restore make targets), root `Dockerfile.mongo`.

### db/postgres/ (overlay — Kysely)

- `apps/server/src/services/db.ts` — `$db: Kysely<Database>` over a `pg` Pool on `$env.DATABASE_URL`; `Database` table types (`roles` as jsonb `ColumnType`).
- `apps/server/src/models/users.ts` / `widgets.ts` — the complete single-file models via Kysely; rows map NULL → `undefined` for `password_hash`/`firebase_id`, `disabled_at` stays `Date | null`, `roles` jsonb parses to `UserRoles[]`; `update`/`updateForUser` build partial `set(...)` objects.
- `apps/server/src/migrations/index.ts` — `runMigrations()` via `Migrator` from `kysely/migration` (0.29+ subpath) with an in-code provider; the single migration follows the `YYYYMMDDHHMMSS-*` naming and creates `users` + `widgets` + the `(user_id, created_at desc)` index. The Migrator's lock table handles concurrent boots.
- `apps/server/src/utils/env.ts` — common env + `DATABASE_URL` (getenv).
- `apps/server/src/test/db-helpers.ts` — Kysely/pg seeding/handles/teardown/cleanup; `db.users()`/`db.widgets()` expose the Mongo-collection-style method surface the shared base tests call (`insertOne`, `findOne`, `deleteMany`, …).
- `apps/server/package.json` — PARTIAL adding `kysely` + `pg` (+ `@types/pg`).

### server/redis/ (fragment — copied when cache OR rate limiting is selected)

- `apps/server/src/services/redis.ts` — `$redis`, a node-redis client on `$env.REDIS_URL`, connecting at module load; `REDIS_URL` is validated at load so a missing value fails the boot, not the first request.
- `apps/server/package.json` — PARTIAL adding the `redis` dep.
- Purely additive: base never imports it; the cache and rate-limit fragments do.

### server/rate-limit/ (fragment — copied when rate limiting is selected)

- `apps/server/src/middleware/rate-limit.ts` — OVERWRITES base's no-op with the Redis-backed limiter: fixed-window `INCR`+`EXPIRE` counters per `bucket` + key, built-in `"ip"` / `"auth-token"` key strategies or a custom resolver, `X-RateLimit-*` headers, 429 via `TooManyRequests`, skipped outside production. Same exported API as the base no-op (`RATE_LIMIT(opts)`, `RateLimitKey`, `RateLimitOptions`), so call sites never change.
- Depends on `$redis` — the CLI composes `server/redis/` whenever this axis is on.

### server/workers/ (fragment — copied when workers is selected)

- New modules: `apps/server/src/services/bull.ts` (the `$bull.Queue` factory — BullMQ queue+worker pair on `$env.REDIS_URL`, failure alerts), `src/services/queue-jobs.ts`, `src/app/queues.ts` (queue autoload/registry), `src/workers.ts` (the workers-process entrypoint), `src/handlers/auth/send-login-email.queue.ts` + `send-reset-password-email.queue.ts`.
- OVERWRITES: `src/backend.ts` (adds the bull-board mount), `process.config.js` (backend + workers processes), `src/handlers/email/dispatch.ts` (dispatch enqueues on the two queues instead of sending inline).
- `apps/server/package.json` — PARTIAL adding `bullmq` + the `@bull-board/*` deps and the `dev:workers` script. `bullmq` embeds `ioredis`, so this fragment needs only `REDIS_URL` — it does NOT require `server/redis/`.

### server/cache/ (fragment — copied when cache is selected)

- `apps/server/src/services/cache.ts` — `$cache` (`get`/`set`/`del`/`getOrSet`) over `$redis`, plus an integration test.
- Depends on `$redis` — the CLI composes `server/redis/` whenever this axis is on.

### frontend/tanstack/ (overlay)

- `apps/web/**` — Vite + TanStack Router SPA: file-based routes (`src/routes/`), `tsr.config.json` + `scripts/gen-routes.mjs` (route tree generated into `__generated__/`, wired into `type-check`), `$server` on `@pimasi/utils/lib/http` with `VITE_API_URL`, `$token` localStorage module, `useAuth` provider, widgets SWR hook + page. Ships no theme CSS or `components/ui/*` (design overlay provides them).
- Root `Dockerfile.web` (vite build → nginx) + `apps/web/nginx.conf`.

### frontend/nextjs/ (overlay)

- `apps/web/**` — Next.js App Router app (package `pimasi-web`): pages `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/set-password`, `/widgets` (protected, client components — the app is a client-rendered SPA over the Express API), `lib/server.ts` (`$server` on `@pimasi/utils/lib/http` with `NEXT_PUBLIC_API_URL` + bearer interceptor), `lib/token-storage.ts` (SSR-guarded localStorage), `hooks/use-auth`, widgets SWR hook + page, `next.config.ts` (`transpilePackages: ["@pimasi/lib"]`), `@tailwindcss/postcss` setup, `app/layout.tsx` (globals.css comes from the design overlay). `typescript` is pinned to ^6 in this workspace (Next cannot drive TS 7's compiler API; `.ncurc.json` rejects it from update-deps).
- Root `Dockerfile.web` for Next (build + `next start`; container port 3000; dev runs `next dev -p 5173`).

### cordova/tanstack/ + cordova/nextjs/ (overlays)

- The cordova shell (`apps/web/cordova/**` with id `com.__APP_SLUG__.app`), `.env.cordova.example`, and a web package.json PARTIAL adding `build:cordova` (tanstack: `vite build --mode cordova` → copy `dist/` into `cordova/www/`; nextjs: static `output: "export"` → copy `out/`). The exported app must point at a remote API URL.

## The CLI (`src/`)

- Node ESM TypeScript; `bin` `create-pimasi-app` → `dist/index.js` (`tsc` build; `tsx src/index.ts` for dev). Deps: `@clack/prompts` + `picocolors` only.
- Wizard order: app name (kebab-validated; becomes the package scope) → frontend → cordova → database → workers → cache → rate limiting → design → target dir (refuse non-empty unless `--force`). Every prompt has a flag twin: `--name`, `--frontend`, `--db`, `--design`, `--cordova`/`--no-cordova`, `--workers`/`--no-workers`, `--cache`/`--no-cache`, `--rate-limit`/`--no-rate-limit`, `--dir`, plus `--yes` (non-interactive, defaults + flags — workers OFF, cache ON, rate limiting ON), `--no-install`, `--no-git`, `--force`, `--help`.
- Modules: `index.ts` (flags/prompts/orchestration), `compose.ts` (recursive copy with deep-merge for overlay `package.json` files, placeholder/token replacement), `generate.ts` (docker-compose / .env.example / README Stack-block renderers), `templates.ts` (resolve `templates/` by walking up from the running module until a directory holding both `templates/` and `DESIGN.md` is found — works from `dist/` and from source), `types.ts`.
- `renderDockerCompose({slug, frontend, database, design, cordova, workers, cache, rateLimit})`: DB service (`<slug>-mongo` replica-set with healthcheck, or `<slug>-postgres` postgres:16 with `pg_isready`), `<slug>-redis` only when workers, cache, or rate limiting is selected, `<slug>-server` (port 4000, DB url env + `REDIS_URL` when Redis ships), `<slug>-web` (port 5173, `VITE_API_URL` or `NEXT_PUBLIC_API_URL`), with compose watch-sync blocks.
- `renderEnvExample(selections)`: `JWT_SECRET` plus `MONGO_PASSWORD` or `POSTGRES_PASSWORD` (the connection URLs themselves are wired in the generated docker-compose and only noted as comments), and optional Firebase + SendGrid blocks (blank disables them).

## Verification bar

A change to templates or CLI is verified by generating projects and proving them, not by reading. Minimum: for each affected axis, generate a combo, `npm install`, `npm run type-check`, `npm run build`; for server-touching changes also run the vitest suite against live containers (both databases when `db/` or base server code changed). The four canonical combos: tanstack+mongo, tanstack+postgres, nextjs+mongo, nextjs+postgres, with cordova toggled on at least once and the server axes (workers/cache/rate limiting) exercised at both extremes — at least one combo with all three ON and one with all three OFF.

## Conventions

- **Case by boundary**: `snake_case` ONLY for external contracts — API request/response fields, DB columns/document fields, queue/message payloads, JWT claims, env-var-shaped config. Everything internal is `camelCase`: local variables, function parameters, internal option objects, React state setters. camelCase fns; PascalCase types; UPPER_SNAKE module consts; kebab files; `let` in functions / `const` module-level.
- **Timestamped generated content** (migrations, ADRs, and anything similar) is named `YYYYMMDDHHMMSS-{kebab-description}` (14-digit, to the second) — e.g. `20260709120000-create-initial-indexes.ts`. Never sequential `0001` prefixes, never unix seconds.
- **HTTP + validation**: never `ajv`, `zod`, raw `fetch`, or `axios` — `@pimasi/utils` covers all of it (`lib/http`, `lib/json-schema`). This includes test helpers and client-side wrappers.
- British English; no AI-authored comments EVER (only humans write comments; preserve existing ones); ULID string ids everywhere (`ulid()`).
- **TypeScript + Prettier only, never ESLint** — no eslint configs, plugins, or deps in any workspace; tsc is the correctness gate, prettier the style gate. All source is TypeScript.
- Keep template dependency ranges at the LATEST published majors (verify with `npm view <pkg> version`); generated projects ship `make update-deps` (npm-check-updates across workspaces). Known hold-backs: `yargs` ^17 (v18 is ESM-only; the server compiles to CJS) and the Next.js web app's `typescript` ^6 (see frontend/nextjs above).
- Generated projects are **Docker-first and 100% dockerised** in dev: `make` targets wrap docker compose; ALL tests (every package, current and future) run inside the containers via `make test`; only type-check and formatters run on the host. README prose never hardcodes container names — `make` targets are the interface.
- AI agents working in generated projects must not use plan mode — they write plans to a gitignored `.scratch/` folder and validate with the user first (rule lives in the base README's AI section).
