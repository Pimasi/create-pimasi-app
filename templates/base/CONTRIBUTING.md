# Contributing to __APP_SLUG__

Start with the [root README](README.md) for setup, architecture, and common
commands. This guide is the canonical source for conventions that apply to
every contributor, whether human or automated. Agent-specific behavioural
rules live in [AGENTS.md](AGENTS.md). When CI and releases are enabled,
[RELEASE.md](RELEASE.md) owns their setup, operation and deployment contract.

## Docker conventions

- **Dockerfiles live in the repo root** — named `Dockerfile.<service>` (`Dockerfile.server`, `Dockerfile.web`, and `Dockerfile.mongo` on Mongo). Never place them in subdirectories.
- **The Docker build context is always `.`** (repo root) in `docker-compose.yml`.
- **Every build-time web env var (`VITE_*` for Vite, `NEXT_PUBLIC_*` for Next) in `docker-compose.yml` must also be an `ARG` in `Dockerfile.web`.** The bundler inlines these at build time, so runtime env vars alone are not enough.

## Code style

| Element                                            | Convention             | Example             |
| -------------------------------------------------- | ---------------------- | ------------------- |
| Internal variables & parameters                    | `camelCase`            | `invoiceCount`      |
| External contract fields (API, DB, queue messages) | `snake_case`           | `created_at`        |
| Functions                                          | `camelCase`            | `createInvoice()`   |
| Types / Classes                                    | `PascalCase`           | `InvoiceModel`      |
| Top / module-level constants                       | `UPPER_SNAKE_CASE`     | `MAX_RETRIES`       |
| File names                                         | `lowercase-kebab-case` | `create-invoice.ts` |

- All variables inside a function that are **not** module-level must use `let`, not `const`.
- All module-level declarations must use `const`.

### Tooling — TypeScript + Prettier, never ESLint

**All source is TypeScript** — no `.js`/`.jsx` app code. The correctness gate is the compiler (`make type-check`); the style gate is Prettier (`make format`, enforced by the pre-commit hook). **Never add ESLint** — no configs, no plugins, no `eslint-*` dependencies, in any workspace. If a rule feels missing, it belongs in the type system or in this guide, not in a linter.

Release tooling under `scripts/release/`, when present, is the explicit source-language exception: POSIX `sh`, with POSIX awk for deterministic notes.

### Language — British English

**British English is the default for all prose AND for new code identifiers: docs, comments, commit messages, UI copy, error messages, function names, variable names, types, API field names.** Use `organise`, `colour`, `behaviour`, `centre`, `licence` (noun) / `license` (verb), `realise`, `analyse`, `defence`, `normalise`, `-isation` endings, etc. Do **not** "normalize" British spellings to American because a spellchecker flags them — the spelling is intentional.

When **inventing** a new identifier, prefer the British form (`normaliseEmail`, not `normalizeEmail`; `colourPalette`, not `colorPalette`). The narrow exception is **renaming** an existing identifier that's already US-spelled and has many callers — leave it if the rename would just be churn; otherwise rename it. Vendor APIs we call (Firebase's `authorizedDomains`, the HTTP `Authorization` header, Tailwind's `text-color-*`) keep their wire-format casing because they're not ours to change.

### Naming — case by boundary

**`snake_case` marks an external contract; everything internal is `camelCase`.** The boundary is serialisation: a field that crosses the wire or hits a datastore keeps its `snake_case` wire shape, and a name that only ever lives inside the process uses normal TypeScript casing.

- **`snake_case` (external contracts):** API request/response fields, DB columns/document fields, queue/message payloads, JWT claims. These are the shapes in `@pimasi/lib` schemas and `apps/server/src/models/` (`created_at`, `password_hash`, `user_id`, `email_verified`).
- **`camelCase` (internal code):** local variables, function parameters, internal option/config objects, React state setters (`const [name, setName] = useState()`).

```ts
// GOOD — internal options object, never serialised: camelCase keys
interface RateLimitOptions {
    bucket: string;
    windowSeconds: number;
    maxRetries: number;
}

// GOOD — API schema, a wire contract: snake_case fields
export const InvoiceSchema = Schema.Object({
    id: Schema.String(),
    user_id: Schema.String(),
    created_at: Schema.String(),
});

// BAD — casing leaking across the boundary
interface RateLimitOptions {
    window_seconds: number; // ❌ internal, so camelCase
}
export const InvoiceSchema = Schema.Object({
    createdAt: Schema.String(), // ❌ wire field, so snake_case
});
```

The payoff: a `snake_case` key signals "this exact name appears on the wire or in the database", so a grep for `created_at` finds every use of the contract field and nothing else. Vendor APIs are external contracts too (Firebase Admin's `errorInfo`, the HTTP `Authorization` header): match their casing at the boundary, `camelCase` internally either way.

### String enums

A closed set of string values is a string `enum`, never a string-literal type. That covers unions (including unions of property names), single-literal discriminants such as `type: "notification"`, schema literals (`Schema.Const`, `Schema.String({ enum })`, OpenAPI `enum` lists) and types derived from `as const`, `keyof typeof` or `typeof` a string constant. Name the enum in singular `PascalCase` and its members in `UPPER_SNAKE_CASE`; each member's value is the string it replaces, so wire formats do not change.

```ts
// GOOD: the enum holds the strings, and everything else uses its members
export enum InvoiceStatus {
    DRAFT = "draft",
    PAID = "paid",
}

export const InvoiceStatusSchema = Schema.String({
    enum: Object.values(InvoiceStatus),
});
let isPaid = invoice.status === InvoiceStatus.PAID;

// BAD: raw strings for a closed set
type InvoiceStatus = "draft" | "paid"; // ❌ string-literal union
let isPaid = invoice.status === "paid"; // ❌ raw string
```

- **Members, never raw strings:** compare, assign, pass and `case` on `InvoiceStatus.PAID`. tsc accepts a raw string that matches a member, so check for them in review.
- **Lists and discriminants:** derive lists with `Object.values(InvoiceStatus)`, whose order is declaration order; discriminate with `Schema.Const(InvoiceStatus.PAID)` in schemas and `status: InvoiceStatus.PAID` in types.
- **Home:** an enum used by more than one workspace lives in `@pimasi/lib` (`apps/shared/lib/src/values/`); otherwise it sits beside its first use. When that use is a component or route file, the enum gets its own `.ts` module so Fast Refresh keeps working. A test-only enum lives in its test file, or in `apps/server/src/test/` when several server tests share it.
- **Plain data:** a constant list whose literal types nothing reads, such as SVG path data, takes a `readonly string[]` annotation instead of an enum.
- **Wire values:** an enum whose values are stored or sent (API fields, JWT claims, queue and socket payloads, stored documents, environment values) is pinned beside its declaration with `wireValues` from `@pimasi/lib/values/wire`: `wireValues(InvoiceStatus, ["draft", "paid"]);`. The pin type-checks only while those raw strings and the enum's values are the same set, and it rejects members in place of strings, so a changed value fails `type-check` until the pin changes with it in the same diff. Those strings are the one place a raw value is correct. Build-tool switches set in package scripts, such as the Cordova build flag, are not pinned.
- **Exempt:** the raw strings in wire-value pins, key references (`keyof T` of a declared type, `Pick`/`Omit` key arguments, `T["key"]`, `obj[key as keyof typeof obj]`), module specifiers, vendor-mandated literals such as `ComponentProps<"div">`, generated files and completed migrations. A completed migration that a live enum change stops compiling declares a local enum with the live enum's name and members instead of importing it.

### Implicit / braceless bodies — only when they fit on one line

**Do not use implicit-body syntax (arrow function implicit return, braceless `if` / `else` / `else if`) when the body wraps to a new line or doesn't fit on a single line under 80 characters.** When it doesn't fit, use an explicit block body — `async`/`await` with `{ … }` for arrow functions, `{ … }` for `if`/`else`.

```ts
// BAD — braceless if with body on a new line
if (body.starts_at !== undefined) updates.starts_at = new Date(body.starts_at);

// GOOD — body wraps to a new line, so use braces
if (body.starts_at !== undefined) {
    updates.starts_at = new Date(body.starts_at);
}

// GOOD — fits on one line, braceless is fine
if (foo) return;
```

## Backend conventions

### IDs — ULID string ids everywhere

**Every row/document has its own `id: string` field generated by `ulid()` from the `ulid` npm package.** Use `id` in all queries, references, foreign keys, and API responses. (On MongoDB the driver still creates an `_id` under the hood — ignore it; never use `_id` or `ObjectId`.)

- Schema field: `id: string` (typed in the model, populated at insert time).
- Generation: `import { ulid } from "ulid"; let id = ulid();` — inline at the call site, not via a wrapper.
- Foreign keys follow the same convention: `user_id: string`, `invoice_id: string`, etc., all storing ULIDs.
- Test seeders and route handlers all use `ulid()` directly — match that pattern when adding a new collection/table.

Why: ULIDs are sortable by creation time, URL-safe, and human-readable, which makes them better for logs, debugging, and API surfaces. Consistency across the schema matters more than any one ID's properties — do not introduce a different ID scheme for a "special" table.

### Database — one repository interface, two implementations

**The server never talks to the database driver directly.** Each file in `apps/server/src/models/` is self-contained: it defines the domain type, the `*Repo` interface, and the concrete implementation for this project's database (MongoDB or Postgres/Kysely) in one place. Handlers depend only on exported repository objects such as `$users` (or `$invoices` for a new invoice feature). To add a new persisted resource, create one `models/<resource>.ts` with its type, its `*Repo` interface, and the implementation together — do not reach for the raw client inside a handler.

### Schemas — `@pimasi/utils`, never Zod or ajv

**All runtime schemas use `Schema` from `@pimasi/utils/lib/json-schema`.** Do not introduce Zod, ajv, or any other validation library — schemas, request/response validation, and type inference all go through `@pimasi/utils`. This applies everywhere: `apps/shared/lib/src/schemas/api/*`, request-body validation in routes (`Schema.validate(req.body, RequestSchema)`), and any new value-object schema you might be tempted to type with another library.

```ts
// GOOD — @pimasi/utils Schema
import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export const FooRequestSchema = Schema.Object({
    foo_id: Schema.String(),
    quantity: Schema.Optional(Schema.Number()),
});
export type FooRequest = Static<typeof FooRequestSchema>;

// BAD — never import zod or ajv
import { z } from "zod"; // ❌
import Ajv from "ajv"; // ❌
```

Discriminated unions use `Schema.AnyOf([...])` with `Schema.Const(Enum.MEMBER)` discriminators, and closed value sets are [string enums](#string-enums). `Static<typeof X>` infers the TypeScript type from the schema. Match what existing schemas in `apps/shared/lib/src/schemas/api/*` already do — that is the canonical pattern.

## Frontend conventions

### Tailwind CSS — colour usage

**Never use bespoke/hardcoded Tailwind colour classes** (e.g. `bg-purple-600`, `text-blue-500`). All colours must reference the semantic design tokens defined in the web app's theme stylesheet (`src/styles.css` on TanStack, `app/globals.css` on Next.js). Both design systems (shadcn/ui and bespoke) define the **same shadcn-standard token vocabulary**, so pages never fork per design:

| Token pair                           | Use for                                          |
| ------------------------------------ | ------------------------------------------------ |
| `background` / `foreground`          | page background and default text                 |
| `card` / `card-foreground`           | elevated surfaces (cards, panels) and their text |
| `popover` / `popover-foreground`     | floating surfaces (menus, dropdowns, tooltips)   |
| `primary` / `primary-foreground`     | primary actions and the text on them             |
| `secondary` / `secondary-foreground` | secondary actions and the text on them           |
| `muted` / `muted-foreground`         | subdued surfaces and secondary text              |
| `accent` / `accent-foreground`       | hover/highlight surfaces and their text          |
| `destructive`                        | errors and destructive actions                   |
| `border` / `input` / `ring`          | borders, form-control borders, focus rings       |
| `success` / `success-foreground`     | positive status (the one PIMASI extension token) |

`--radius` drives border radii. The usual patterns:

- **Page layout:** `bg-background text-foreground` on the root/body
- **Cards/panels:** `bg-card text-card-foreground border border-border rounded-lg`
- **Primary buttons:** `bg-primary text-primary-foreground hover:bg-primary/90` — hover states always use opacity modifiers (`/90`, `/80`), never `-hover` token variants (they don't exist)
- **Links:** `text-primary hover:underline`
- **Status indicators:** `text-success` for positive, `text-destructive` for errors

```tsx
// BAD — hardcoded / arbitrary colours
<button className="bg-cyan-500 text-white hover:bg-cyan-600">
<div className="bg-[#030B0E] text-[#f2f2f2]">

// GOOD — semantic tokens
<button className="bg-primary text-primary-foreground hover:bg-primary/90">
<div className="bg-background text-foreground">
```

### HTTP requests — `@pimasi/utils/lib/http` only

**Never use raw `fetch()` or `axios`, anywhere in the repo, including tests.** `@pimasi/utils/lib/http` (an axios-compatible HTTP client over native fetch) is the only HTTP client. In the web app that means the `$server` client built on it: its base URL comes from the web app's public API env var (`VITE_API_URL` on the Vite/TanStack app, `NEXT_PUBLIC_API_URL` on the Next.js app), and it auto-attaches the JWT auth token via a request interceptor — no manual `Authorization` header needed. Server tests make their HTTP calls through the `$test` helpers, which sit on the same client.

```tsx
import { $server } from "@/services/server"; // path may vary per frontend

// GET
let res = await $server<Invoice[]>({ method: "GET", url: "/invoices" });
let invoices = res.data;

// POST
let res = await $server<{ token: string }>({
    method: "POST",
    url: "/auth/login-with-password",
    data: { email, password },
});
let token = res.data.token;
```

```tsx
// BAD — raw fetch with manual headers
let res = await fetch(`${API_BASE}/invoices`, {
    headers: { Authorization: `Bearer ${token}` },
});

// GOOD — $server(config) handles base URL and auth
let res = await $server<Invoice[]>({ method: "GET", url: "/invoices" });
```

The bearer token `$server` attaches comes from the web app's `token-storage` module — **never read or write `localStorage` directly for auth tokens**; the module is the single place to swap the backing store later.

## Testing

### Tests — all of them, always inside Docker

**Every test in this repo MUST run inside its Docker container — never on the host.** PIMASI apps are Docker-first; this is a hard rule, not a preference. The suite is an integration suite: it talks to the live database (and Redis, when selected) from the compose stack, uses the same env vars as the running server, and assumes the same Node version, native modules, and filesystem layout. Running on the host gives misleading results. This applies to **every current and future test target** in the repo, not just the server.

```sh
# GOOD — run the full suite (wraps docker exec into the server container)
make test

# GOOD — scope to a single file or pattern
make test ARGS="src/handlers/invoice/list-invoices.test.ts"
make test ARGS="-t 'creates an invoice'"

# BAD — running on the host
cd apps/server && npx vitest          # ❌ wrong DB/Redis, wrong env, will mislead you
```

If `make test` fails because the stack isn't running, bring it up first (`make dev`, or `docker compose up -d` for a detached stack) — do not fall back to the host. If you add a new test target, wire it into `make test` (or a sibling make target that also execs into a container) — never introduce a host-only test path.

### Server endpoint testing

**Every server endpoint MUST ship with a test.** Creating a new `*.route.ts` without a matching `*.test.ts` is not allowed — the two files land in the same commit. Tests assume a running server and verify behaviour via HTTP calls + database assertions.

- Use the `$test` helper from `apps/server/src/test/helpers.ts` for seeding, HTTP calls, DB access, and cleanup.
- Test both success and error cases (auth, validation, DB side effects).
- Use `$test.seed()` / `$test.teardownSeed()` for the test-data lifecycle.
- Verify side effects by querying `$test.db.*` directly.
- See existing tests under `apps/server/src/handlers/` for patterns.

## Documentation

### Keep docs in sync

**When a change alters how the project is built, run, deployed, or decided, update the owning document in the same commit — never as a follow-up.** Humans usually notice when a doc drifts from reality; agents won't, so treat the doc update as part of "done".

- A design decision worth recording → add an ADR under `docs/adr/` (see [ADR and migration naming](#adr-and-migration-naming--yyyymmddhhmmss-kebab-description)).
- A new or changed app under `apps/`, top-level directory, root config file, `make` target, required env var, or build flow → update the [README](README.md) (Architecture, Project structure, and command sections).
- A new, changed, or removed coding/design convention, testing rule, or documentation workflow → update the matching section of this guide.
- A CI, release or deployment change, when enabled → update [RELEASE.md](RELEASE.md).
- A behavioural rule for AI agents → update [AGENTS.md](AGENTS.md).

Pure internal changes (refactors, dependency bumps, bug fixes, tests, route additions, or schema tweaks that don't change a public surface) do **not** need a doc update. When in doubt, ask: "would a teammate cloning the repo today be misled by what the docs say?" If yes, update the owning document.

### ADR and migration naming — `YYYYMMDDHHMMSS-{kebab-description}`

**Every timestamped generated artefact — ADRs under `docs/adr/`, database migrations, and anything similar — uses the 14-digit filename convention `YYYYMMDDHHMMSS-{kebab-description}`** (e.g. `20260709143000-firebase-uid-trust-on-conflict.md`, `20260709143000-create-initial-indexes.ts`). Run `date +%Y%m%d%H%M%S` when creating one. Never use sequential `0001`, `0002`, … prefixes (they invite gap-counting and cause merge conflicts when authors draft in parallel), and never unix seconds (unreadable at a glance).

Cite ADRs from **code comments and other ADRs by slug**, never by number — `// see ADR firebase-uid-trust-on-conflict`, not `// see ADR-0001`. The slug is stable across filename renames; the prefix is not.
