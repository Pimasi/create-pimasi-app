# create-pimasi-app — DESIGN / CONTRACT

`create-pimasi-app` is a `create-next-app`-style scaffolder. It prompts the user, then composes a full-stack TypeScript monorepo from **template fragments** under `templates/`.

Reference implementation (already built, verified, type-checks + builds + 61 tests pass): **`/home/bahatron/git/pimasi-starter`** (a TanStack + Mongo + Express monorepo). Read it for exact framework code, conventions, and file contents — the base + tanstack + mongo fragments are a refactor of it.

## The four prompts

1. **Frontend** — `tanstack` (React 19 + Vite + TanStack Router SPA) or `nextjs` (Next.js App Router, **frontend only** — it is a client of the Express API, NOT full-stack Next).
2. **Cordova** — yes/no (mobile packaging of the web app).
3. **Database** — `mongo` (MongoDB driver) or `postgres` (**Kysely** query builder over `pg`).
4. **Design system** — `shadcn` (shadcn/ui conventions: stock zinc light+dark theme, cva/clsx/tailwind-merge, `components.json`) or `bespoke` (an in-house dark palette, zero extra deps). See "Design-system axis" below.

The Express **server is shared** across both frontends. The database choice swaps only the server's data-access layer, behind a repository interface — the auth + widget handlers never see the driver. The design choice swaps only `apps/web`'s theme CSS + `components/ui/*` implementations, behind a shared component API and token vocabulary — pages are written once.

## Composition model

```
templates/
  base/                     # copied ALWAYS (root tooling, shared/lib, server FRAMEWORK)
  frontend/tanstack/        # -> apps/web (+ Dockerfile.web)   [React/Vite SPA]
  frontend/nextjs/          # -> apps/web (+ Dockerfile.web)   [Next.js app]
  db/mongo/                 # server DB overlay + mongo/ + Dockerfile.mongo
  db/postgres/              # server DB overlay (Kysely)
  design/shadcn/tanstack/   # theme CSS + components/ui + cn + components.json + pkg partial
  design/shadcn/nextjs/     #   (same, Next file layout)
  design/bespoke/tanstack/  # in-house palette under the SAME token names + simple components
  design/bespoke/nextjs/    #   (same, Next file layout)
  cordova/tanstack/         # cordova shell + web package.json partial (build:cordova)
  cordova/nextjs/           # cordova shell + next static-export config
```

There is NO shared UI package (`@pimasi/ui` was removed as overkill). UI primitives live inside `apps/web`, supplied by the design overlay.

CLI compose order (later copies overlay earlier; disjoint paths so no clobber except package.json which is MERGED):
1. copy `base/` → target
2. copy `db/<db>/` → target
3. copy `frontend/<frontend>/` → target
4. copy `design/<design>/<frontend>/` → target
5. if cordova: copy `cordova/<frontend>/` → target
6. **merge** `apps/server/package.json` = deepMerge(base, db partial); **merge** `apps/web/package.json` = deepMerge(frontend, design partial, cordova partial if selected)
7. **generate** `docker-compose.yml`, `.env.example`, and a "## Stack" block in `README.md` from the selections (CLI code, not template files)
8. **placeholder replace** across all text files
9. `git init` (+ optional `npm install`)

### Placeholders and the per-project workspace rename
- `__APP_SLUG__` — kebab app name. Appears in: root `package.json` "name", `apps/web/cordova/config.xml` (id `com.__APP_SLUG__.app` + name), README H1, generated docker-compose container names.
- **Templates keep the literal workspace names** (`@pimasi/lib`, `pimasi-server`, `pimasi-web`, `pimasi_auth_token`) so the template sources stay valid, greppable code. At generate time the CLI renames them by exact-token replacement using the app name: `@pimasi/lib` → `@<slug>/lib` (package name, every import, tsconfig paths, transpilePackages), `pimasi-server` → `<slug>-server`, `pimasi-web` → `<slug>-web`, `pimasi_auth_token` → `<slug_with_underscores>_auth_token`. So an app named `acme` imports `@acme/lib/schemas/...`.
- **Never rename `@pimasi/utils`** (external published dep). The exact-token needles above cannot match it — never add a bare `pimasi` or `@pimasi/` needle.

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
- shadcn overlay: stock zinc theme, light `:root` + dark `.dark` via `@custom-variant dark (&:is(.dark *))` + `@theme inline`, oklch values, per current shadcn/ui Tailwind v4 conventions; ships `components.json` so `npx shadcn add <component>` works afterwards.
- bespoke overlay: the PIMASI indigo/slate dark palette (from the retired `@pimasi/ui`) expressed under these SAME standard names (`card` = old `background-elevated` #151a23, `muted-foreground` = old `foreground-muted` #9aa4b2, primary #6366f1 with `primary-foreground` #ffffff, etc.), dark-only (`:root` holds the dark values).
- shadcn overlay web package.json PARTIAL adds: `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`. Bespoke adds nothing.

## LOCKED repository interface (the DB abstraction)

The base server code depends ONLY on these. **Base ships NO `models/` directory** — the DB overlay owns `apps/server/src/models/users.ts` and `models/widgets.ts` outright, and each file is self-contained: domain type + `*Repo` interface + the concrete `$users`/`$widgets` implementation for that database, in ONE file (no `.impl` indirection). Both overlays must export the identical surface below so base handlers compile against either.

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
    findByFirebaseOrEmail(firebase_id: string, email: string): Promise<UserModel | null>;
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
    listByUser(user_id: string): Promise<WidgetModel[]>;                 // created_at DESC
    findByIdForUser(id: string, user_id: string): Promise<WidgetModel | null>;
    insert(widget: WidgetModel): Promise<void>;
    updateForUser(id: string, user_id: string, changes: WidgetUpdate): Promise<WidgetModel | null>; // updated row or null
    deleteForUser(id: string, user_id: string): Promise<boolean>;       // true if a row was deleted
}
```

### overlay `models/users.ts` shape (single file: types + interface + implementation)
```ts
import { UserRoles } from "@pimasi/lib/values/auth";
import { $mongo } from "../services/db";   // or { $db, Database } for the Kysely overlay
export interface UserModel { ... }         // as above
export interface UsersRepo { ... }         // as above
export const $users: UsersRepo = { ...concrete driver implementation... };
export function normaliseEmail(email: string): string { return email.trim().toLowerCase(); }
```
`models/widgets.ts` mirrors this: exports `WidgetModel`, `WidgetUpdate`, `WidgetsRepo`, the concrete `export const $widgets: WidgetsRepo = { ... }`, and `toWidgetResponse(model): Widget` (Dates -> `.toISOString()`, drop `user_id`; `Widget` type from `@pimasi/lib/schemas/api/widget.schema`). The interface blocks are duplicated verbatim between the two DB overlays — keep them in sync with the contract above; only one overlay ships per generated project.

### Handler refactor (base) — replace raw driver calls with semantic repo calls
Map the existing `/home/bahatron/git/pimasi-starter` handler DB calls:
- `$users.findOne({ id })` → `$users.findById(id)`
- `$users.findOne({ email })` → `$users.findByEmail(email)`
- `find-or-create-user`'s `$users.findOne({ $or:[{firebase_id},{email}] })` → `$users.findByFirebaseOrEmail(firebase_id, email)`
- `$users.insertOne(user)` → `$users.insert(user)`
- `$users.updateOne({ id }, { $set: {...} })` → `$users.update(id, {...})`
- get-session-user re-fetches the hash: `let stored = await $users.findById(user.id); ... password: stored?.password_hash ?? ""`
- parse-session: `let user = await $users.findById(parsed.user_id)`; then `if (user) delete (user as any).password_hash;` before storing in ALS (keep the hash out of the session).
- widgets: `$widgets.insertOne` → `insert`; `find({user_id}).sort(...)` → `listByUser`; `findOne({id,user_id})` → `findByIdForUser`; `findOneAndUpdate` → `updateForUser` (build the `WidgetUpdate` from validated body + `updated_at:new Date()`); `deleteOne` → `deleteForUser` (check boolean for 404).
- Migrations: base `backend.ts` imports `{ runMigrations } from "./migrations"` — the overlay owns `migrations/`.

## File ownership map

### base/ (always copied)
- Root: `package.json` (name `__APP_SLUG__`, deps husky/lint-staged/prettier/turbo; workspaces `["apps/web","apps/server","apps/shared/*"]`; scripts build/type-check/cordova:build/prepare), `turbo.json`, `.prettierrc`, `.prettierignore`, `.gitignore`, `.dockerignore`, `.husky/pre-commit`, `CLAUDE.md`, `.codex`, `.github/copilot-instructions.md`, `README.md` (generic, `# __APP_SLUG__` H1; CLI injects a Stack block), `Dockerfile.server`.
- `apps/shared/lib/**` — copy verbatim from pimasi-starter. (There is no shared UI package.)
- `apps/server/` framework:
  - `src/app/**`, `src/middleware/**`
  - `src/utils/**` EXCEPT `env.ts` (overlay): `jwt.ts, logger.ts, password.ts, request-origin.ts, password.test.ts, normalise-email.test.ts`
  - `src/services/**` EXCEPT the DB connection: `redis.ts, bull.ts, sendgrid.ts, alerts.ts, queue-jobs.ts, firebase-admin.ts`
  - `src/handlers/**` (auth, user, email, ping, **widget**) — all REFACTORED to the repo interface
  - `src/models/users.ts`, `src/models/widgets.ts` (types + interface + wiring, per above)
  - `src/backend.ts, workers.ts, cli.ts, process.config.js`
  - `src/test/helpers.ts` (http helpers + `$test` assembly; imports `seedUser`, `db`, `teardownSeed`, `cleanup` from `./db-helpers`), `src/test/setup.ts`
  - `package.json` (common server deps, NO db driver), `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `.gitignore`

### db/mongo/ (overlay)
- `apps/server/src/services/db.ts` — `export const $mongo = new MongoClient($env.MONGO_URL).db($env.MONGO_DATABASE)`
- `apps/server/src/models/users.ts` + `models/widgets.ts` — the complete single-file models (types + `*Repo` interfaces + `$users`/`$widgets` backed by `$mongo.collection(...)`; widgets uses findOneAndUpdate returnDocument:"after" etc.)
- `apps/server/src/migrations/index.ts` (the advisory-lock `runMigrations` from pimasi-starter) + `migrations/migration.ts` factory location note: keep the `Migration` factory in `app/migration.ts` (base already has it) + one concrete migration creating indexes (users unique {email}, widgets {user_id, created_at:-1})
- `apps/server/src/utils/env.ts` — common env + `MONGO_URL` (getenv), `MONGO_DATABASE` (getenv)
- `apps/server/src/test/db-helpers.ts` — Mongo test seeding/handles/teardown/cleanup
- `apps/server/package.json` — PARTIAL: `{ "dependencies": { "mongodb": "^6.21.0" } }`
- `mongo/**` (entrypoint.sh replica-set init, scripts) and root `Dockerfile.mongo`

### db/postgres/ (overlay — Kysely)
- `apps/server/src/services/db.ts` — a Kysely instance over `pg` Pool: `export const $db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: $env.DATABASE_URL }) }) })`. Also `export interface Database { users: UsersTable; widgets: WidgetsTable; migrations?: ... }` (Kysely table types; use `Generated`/`ColumnType` as needed; `roles` stored as `jsonb`).
- `apps/server/src/models/users.ts` / `widgets.ts` — the complete single-file models: types + interfaces + `$users`/`$widgets` via Kysely; map DB rows → models (NULL → `undefined` for `password_hash`/`firebase_id`; `disabled_at` stays `Date | null`; parse `roles` jsonb → `UserRoles[]`). `update` builds a partial `set(...)`.
- `apps/server/src/migrations/index.ts` — `runMigrations()` using Kysely's `Migrator` with an in-code migration provider; migration `0001_init` creates `users` (id pk text, timestamps timestamptz, email unique, jsonb roles, nullable password_hash/firebase_id/disabled_at) and `widgets` (id pk, user_id fk-ish text, timestamps, index on (user_id, created_at desc)). Ensure it is idempotent / advisory-locked (Kysely Migrator handles a migration lock table).
- `apps/server/src/utils/env.ts` — common env + `DATABASE_URL` (getenv).
- `apps/server/src/test/db-helpers.ts` — Postgres/Kysely test seeding/handles/teardown/cleanup (own pool).
- `apps/server/package.json` — PARTIAL: `{ "dependencies": { "kysely": "^0.28.0", "pg": "^8.13.0" }, "devDependencies": { "@types/pg": "^8.11.0" } }`

### frontend/tanstack/ (overlay)
- `apps/web/**` = pimasi-starter `apps/web` MINUS the cordova shell dir and the `build:cordova` script (those move to cordova overlay). Keep the harmless vite cordova-mode + main.tsx hash-history switch. `$server` base = `import.meta.env.VITE_API_URL`.
- root `Dockerfile.web` (vite build → nginx), `apps/web/nginx.conf`.

### frontend/nextjs/ (overlay)
- `apps/web/**` = a **Next.js (App Router)** app (package `pimasi-web`, `type: module`), TypeScript, Tailwind 4 (`@tailwindcss/postcss`), importing UI primitives from `@/components/ui/*` (supplied by the design overlay). It is a **client of the Express API** — all data via a `$server` (fetch wrapper) pointed at `process.env.NEXT_PUBLIC_API_URL`. Implement the same surface as the tanstack app:
  - Pages (App Router, `app/`): `/` (landing), `/login`, `/register`, `/forgot-password`, `/reset-password`, `/set-password`, `/widgets` (protected — client component; redirect to /login if unauthenticated). Use `"use client"` where needed; this app is effectively a client-rendered SPA over the Express API.
  - Auth: token in `localStorage` via a `token-storage` module; a `useAuth` hook/provider; login/register call Express `/auth/*`; a `$server` fetch wrapper attaches the bearer token. (Firebase optional — keep a guarded `firebase.ts`; the Google button may be omitted for the Next variant to reduce scope, OR kept guarded. Email+password is the first-class path.)
  - Widgets: SWR (or a small fetch hook) for `GET /widgets` + create/delete via `$server`, mutate after mutation. Reuse `Button`/`Input` from `@/components/ui/*`.
  - `next.config.ts` (transpile `@pimasi/lib` via `transpilePackages`), `postcss.config`, `app/globals.css` (owned by the design overlay), `app/layout.tsx`, `tsconfig.json`, env typing for `NEXT_PUBLIC_API_URL`.
- root `Dockerfile.web` for Next (build + `next start`, or static export served by nginx). Port 3000 in container; dev on 5173-equivalent is `next dev -p 5173`.

### cordova/tanstack/ (overlay)
- `apps/web/cordova/**` (config.xml with id `com.__APP_SLUG__.app`, package.json pinning cordova CLI + android platform), `apps/web/.env.cordova.example`.
- `apps/web/package.json` PARTIAL: `{ "scripts": { "build:cordova": "vite build --mode cordova && rm -rf cordova/www && mkdir -p cordova/www && cp -r dist/. cordova/www/" } }`

### cordova/nextjs/ (overlay)
- `apps/web/cordova/**` shell + a `next.config` override enabling `output: "export"` for the cordova build (static export talks to the remote Express API), + `.env.cordova.example`, + a `build:cordova` script partial that runs the static export and copies `out/` into `cordova/www/`.

## The CLI (`src/index.ts` + package `create-pimasi-app`)
- Node ESM + TypeScript, run via a `bin` (`create-pimasi-app`). Build with `tsc` to `dist/`, `bin` points at `dist/index.js`. Use **`@clack/prompts`** for the wizard and **no other heavy deps** (use `node:fs`/`node:path` for copying; a tiny recursive copy helper). Add `picocolors` optionally.
- Flow: intro → prompt project name (default `my-pimasi-app`, validate kebab) → target dir (default `./<name>`, refuse non-empty) → select frontend → confirm cordova → select database → (if postgres, note "uses Kysely") → spinner while composing → success note with next steps (`cd`, set `.env`, `make dev`).
- Compose: implement the order above. Provide helpers: `copyDir(src,dst)`, `deepMergePackageJson`, `renderDockerCompose({slug,db,frontend,cordova})`, `renderEnvExample({db})`, `injectStackBlock(readmePath, selections)`, `replacePlaceholders(dir, {__APP_SLUG__})`.
- `renderDockerCompose`: mongo → `<slug>-mongo` (replica-set healthcheck) service; postgres → `<slug>-postgres` (`postgres:16`, `POSTGRES_*`, healthcheck `pg_isready`) service. Always: `<slug>-redis`, `<slug>-server` (Dockerfile.server, port 4000, env incl. DB url), `<slug>-web` (Dockerfile.web, port 5173, VITE_/NEXT_PUBLIC_ API url). Watch-sync blocks like pimasi-starter.
- `renderEnvExample`: JWT_SECRET, REDIS_URL note, DB block (MONGO_* or DATABASE_URL/POSTGRES_*), optional Firebase + SendGrid (commented "optional").
- Flags: support `--frontend`, `--db`, `--cordova/--no-cordova`, `--name`, `--yes` (skip prompts using defaults/flags) so it is scriptable + testable non-interactively. This matters for verification.
- Accept being run from source via `tsx src/index.ts` (verification runs it this way) AND resolve `templates/` relative to the package root robustly (e.g. `new URL("../templates", import.meta.url)` from `dist/`, and `./templates` from repo root — resolve by walking up to find a `templates/` dir).

## Verification bar (orchestrator will run)
For each combo the CLI generates a project; then `npm install`, `npm run type-check`, `npm run build`, and (server) `vitest` against a live Postgres/Mongo + Redis must pass. Combos to verify: tanstack+mongo, tanstack+postgres, nextjs+mongo, nextjs+postgres (+ cordova toggled on at least once).

## Conventions
- **Case by boundary**: `snake_case` ONLY for external contracts — API request/response fields, DB columns/document fields, queue/message payloads, JWT claims, env-var-shaped config. Everything internal is `camelCase`: local variables, function parameters, internal option objects, React state setters. camelCase fns; PascalCase types; UPPER_SNAKE module consts; kebab files; `let` in functions / `const` module-level.
- **Timestamped generated content** (migrations, ADRs, and anything similar) is named `YYYYMMDDHHMMSS-{kebab-description}` (14-digit, to the second) — e.g. `20260709143000-create-initial-indexes.ts`. Never sequential `0001` prefixes, never unix seconds.
- **HTTP + validation**: never `ajv`, `zod`, raw `fetch`, or `axios` — `@pimasi/utils` covers all of it (`lib/http`, `lib/json-schema`). This includes test helpers and client-side wrappers.
- British English; no AI-authored comments EVER (only humans write comments; preserve existing ones); ULID string ids everywhere (`ulid()`).
- **TypeScript + Prettier only, never ESLint** — no eslint configs, plugins, or deps in any workspace; tsc is the correctness gate, prettier the style gate. All source is TypeScript.
- Keep template dependency ranges at the LATEST published majors (verify with `npm view <pkg> version`); generated projects ship `make update-deps` (npm-check-updates across workspaces). Known hold-backs: `yargs` ^17 (v18 is ESM-only; the server compiles to CJS) and the Next.js web app's `typescript` ^6 (Next 16 cannot drive TS 7's compiler API; an `.ncurc.json` reject guards it from update-deps).
- Generated projects are **Docker-first and 100% dockerised** in dev: `make` targets wrap docker compose; ALL tests (every package, current and future) run inside the containers via `make test`; only type-check and formatters run on the host. `templates/base` ships the Makefile; `db/mongo` adds seed targets via an included `.mk`. README prose never hardcodes container names — `make` targets are the interface.
- AI agents working in generated projects must not use plan mode — they write plans to a gitignored `.scratch/` folder and validate with the user first (rule lives in the base README's AI section).
