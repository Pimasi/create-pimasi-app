import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  spinner,
} from "@clack/prompts";
import pc from "picocolors";
import { format, type Options as PrettierOptions } from "prettier";
import {
  applyReplacements,
  BINARY_EXTENSIONS,
  buildReplacements,
  IGNORE_ENTRIES,
  isPlainObject,
  type JsonRecord,
  RELEASE_CONFIG,
  setMaintainersOnly,
  targetName,
} from "./compose.js";
import {
  MANIFEST_FILENAME,
  manifestToSelections,
  readManifest,
  renderDockerCompose,
  renderEnvExample,
  renderStackBlock,
  writeManifest,
} from "./generate.js";
import { findTemplatesDir, getCliVersion } from "./templates.js";
import { SERVER_AXES, type Selections, type ServerAxis } from "./types.js";

export const ADD_FEATURES = [...SERVER_AXES, "ci-github", "ci-gitlab"] as const;
export type AddFeature = (typeof ADD_FEATURES)[number];

export interface AddOptions {
  axes: AddFeature[];
  refresh: boolean;
  yes: boolean;
  force: boolean;
  install: boolean;
  projectDir: string;
  maintainersOnly?: boolean;
}

interface ApplyReport {
  written: string[];
  identical: string[];
  conflicts: string[];
  pkgAdded: string[];
  pkgKept: string[];
  upgraded: string[];
  mergeBeforeRelease: string[];
}

interface ApplyContext {
  projectDir: string;
  templatesDir: string;
  pristineFragments: string[];
  selections: Selections;
  refresh: boolean;
  replacements: Record<string, string>;
  prettierOptions: PrettierOptions;
  report: ApplyReport;
  maintainersOnly?: boolean;
}

const AXIS_KEY: Record<
  ServerAxis,
  "workers" | "cache" | "rateLimit" | "websockets"
> = {
  workers: "workers",
  cache: "cache",
  "rate-limit": "rateLimit",
  websockets: "websockets",
};

const AXIS_HINTS: Record<AddFeature, string> = {
  workers: "BullMQ queues + a workers process",
  cache: "Redis-backed $cache service",
  "rate-limit": "Redis-backed rate limiting on the auth routes",
  websockets: "realtime push over the Redis-backed $bus",
  "ci-github": "GitHub Actions CI and releases",
  "ci-gitlab": "GitLab CI and releases",
};

function isCiFeature(
  feature: AddFeature,
): feature is "ci-github" | "ci-gitlab" {
  return feature === "ci-github" || feature === "ci-gitlab";
}

function isProjectOwnedReleaseFile(relPath: string): boolean {
  relPath = relPath.replaceAll("\\", "/");
  return (
    relPath === "scripts/release/deploy.sh" ||
    relPath === "scripts/release/config.sh" ||
    relPath === "scripts/release/environments" ||
    relPath.startsWith("scripts/release/environments/")
  );
}

function selectedFragments(selections: Selections): string[] {
  const fragments = ["base", `db/${selections.database}`];
  if (
    selections.workers ||
    selections.cache ||
    selections.rateLimit ||
    selections.websockets
  ) {
    fragments.push("server/redis");
  }
  if (selections.rateLimit) fragments.push("server/rate-limit");
  if (selections.workers) fragments.push("server/workers");
  if (selections.cache) fragments.push("server/cache");
  if (selections.websockets) fragments.push("websockets/server");
  fragments.push(`frontend/${selections.frontend}`);
  if (selections.websockets) {
    fragments.push(`websockets/${selections.frontend}`);
  }
  fragments.push(`design/${selections.design}/${selections.frontend}`);
  if (selections.cordova) fragments.push(`cordova/${selections.frontend}`);
  return fragments;
}

async function formatPristine(
  content: string,
  relPath: string,
  ctx: ApplyContext,
): Promise<string> {
  if (!/\.(?:[cm]?[jt]sx?|json|ya?ml|md)$/.test(relPath)) return content;
  try {
    return await format(content, {
      filepath: relPath,
      tabWidth: 4,
      singleQuote: false,
      ...ctx.prettierOptions,
      plugins: [],
    });
  } catch {
    return content;
  }
}

function renderPristine(
  path: string,
  relPath: string,
  ctx: ApplyContext,
): string {
  const source = applyReplacements(
    readFileSync(path, "utf8"),
    ctx.replacements,
  );
  if (relPath !== "README.md") return source;
  const lines = source.split("\n");
  const heading = lines.findIndex((line) => /^#\s+/.test(line));
  lines.splice(heading + 1, 0, renderStackBlock(ctx.selections).trimEnd());
  return lines.join("\n");
}

async function isPristine(
  relPath: string,
  onDisk: string,
  ctx: ApplyContext,
): Promise<boolean> {
  const legacyDir = join(ctx.templatesDir, "legacy");
  const roots = [ctx.templatesDir];
  if (existsSync(legacyDir)) {
    for (const entry of readdirSync(legacyDir, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(join(legacyDir, entry.name));
    }
  }
  const normalised = await formatPristine(onDisk, relPath, ctx);
  for (const root of roots) {
    const fragment = [...ctx.pristineFragments].reverse().find((name) => {
      return existsSync(join(root, name, relPath));
    });
    if (!fragment) continue;
    const pristine = renderPristine(
      join(root, fragment, relPath),
      relPath,
      ctx,
    );
    const variants = [pristine];
    if (relPath === "apps/server/src/utils/env.ts") {
      variants.push(pristine.replace(/^.*RATE_LIMIT_ENABLED:.*\n/m, ""));
    }
    if (relPath === "apps/server/src/middleware/rate-limit.ts") {
      variants.push(
        pristine
          .replace(/^ \* Set RATE_LIMIT_ENABLED=false.*\n/m, "")
          .replace(" || !$env.RATE_LIMIT_ENABLED", ""),
      );
    }
    for (const variant of variants) {
      if (
        onDisk === variant ||
        normalised === (await formatPristine(variant, relPath, ctx))
      ) {
        return true;
      }
    }
  }
  return false;
}

async function upgradePrerequisite(
  fragment: string,
  relPath: string,
  description: string,
  ctx: ApplyContext,
  formattingOnly = false,
): Promise<void> {
  const dstRel = join(dirname(relPath), targetName(basename(relPath)));
  const dstPath = join(ctx.projectDir, dstRel);
  if (formattingOnly && !existsSync(dstPath)) return;
  const onDisk = existsSync(dstPath) ? readFileSync(dstPath, "utf8") : null;
  if (
    !formattingOnly &&
    onDisk !== null &&
    prerequisiteSatisfied(relPath, onDisk, ctx.selections.rateLimit)
  ) {
    return;
  }
  const incoming = formattingOnly
    ? await formatPristine(onDisk!, relPath, ctx)
    : applyReplacements(
        readFileSync(join(ctx.templatesDir, fragment, relPath), "utf8"),
        ctx.replacements,
      );
  if (onDisk === incoming) return;
  if (onDisk === null || (await isPristine(relPath, onDisk, ctx))) {
    mkdirSync(dirname(dstPath), { recursive: true });
    writeFileSync(dstPath, incoming);
    ctx.report.upgraded.push(`${dstRel}: ${description}`);
  } else {
    writeFileSync(dstPath + ".new", incoming);
    ctx.report.mergeBeforeRelease.push(`${dstRel}.new: ${description}`);
  }
}

function prerequisiteSatisfied(
  relPath: string,
  content: string,
  rateLimit: boolean,
): boolean {
  const path = relPath.replaceAll("\\", "/");
  const releaseArguments =
    /^ARG APP_VERSION(?:=|$)/m.test(content) &&
    /^ARG GIT_SHA(?:=|$)/m.test(content);
  switch (path) {
    case "_gitignore":
      return ["node_modules/", "dist/", ".env"].every((line) => {
        return content.split(/\r?\n/).includes(line);
      });
    case "apps/server/_gitignore":
      return content.split(/\r?\n/).includes("testy.cli.*");
    case "Dockerfile.server":
      return releaseArguments && /^CMD\s+\S/m.test(content);
    case "Dockerfile.web":
      return releaseArguments && /^WORKDIR \/app\/apps\/web\s*$/m.test(content);
    case "apps/server/process.config.js":
      return /instances:\s*process\.env\.PM2_INSTANCES\s*\|\|\s*1/.test(
        content,
      );
    case "apps/server/src/app/process-config.test.ts":
      return (
        content.includes("PM2_INSTANCES") &&
        content.includes("./process.config.js") &&
        /expect\(counts\)\.toEqual\(counts\.map\(\(\) => value \|\| 1\)\)/.test(
          content,
        )
      );
    case "apps/server/src/utils/env.ts":
      return (
        /^\s*APP_VERSION\s*:/m.test(content) &&
        /^\s*GIT_SHA\s*:/m.test(content) &&
        (!rateLimit || /^\s*RATE_LIMIT_ENABLED\s*:/m.test(content))
      );
    case "apps/server/src/middleware/rate-limit.ts":
      return content.includes("!$env.RATE_LIMIT_ENABLED");
    case "apps/server/src/handlers/ping.route.ts":
      return (
        /version:\s*\$env\.APP_VERSION/.test(content) &&
        /commit:\s*\$env\.GIT_SHA/.test(content) &&
        !/console\.log\(\$env\)/.test(content)
      );
    case "apps/server/src/handlers/ping.test.ts":
      return (
        /expect\(res\.data\.version\)/.test(content) &&
        /expect\(res\.data\.commit\)/.test(content)
      );
    case "apps/shared/lib/src/schemas/api/ping-response.schema.ts":
      return (
        /version:\s*Schema\.String\(\)/.test(content) &&
        /commit:\s*Schema\.String\(\)/.test(content)
      );
    case "apps/server/src/app/readiness.ts":
      return (
        /export function registerReadinessCheck\s*\(/.test(content) &&
        /export async function runReadinessChecks\s*\(/.test(content) &&
        /Promise\.all\s*\(/.test(content) &&
        /Promise\.race\s*\(/.test(content) &&
        /\.then\(check\)/.test(content) &&
        content.includes('"unavailable"')
      );
    case "apps/server/src/app/readiness.test.ts":
      return (
        /registerReadinessCheck\s*\(/.test(content) &&
        /runReadinessChecks\s*\(/.test(content) &&
        /advanceTimersByTimeAsync\s*\(/.test(content) &&
        content.includes('"failed"')
      );
    case "apps/server/src/handlers/ready.route.ts":
      return (
        /route:\s*["']\/ready["']/.test(content) &&
        /await runReadinessChecks\s*\(/.test(content) &&
        /\.status\([^)]*\?\s*200\s*:\s*503\)/.test(content)
      );
    case "apps/server/src/handlers/ready.test.ts":
      return (
        content.includes('"/ready"') &&
        content.includes("registerReadinessCheck(") &&
        /\.status\)\.toBe\(503\)/.test(content) &&
        /\.status\)\.toBe\(200\)/.test(content)
      );
    case "apps/shared/lib/src/schemas/api/ready-response.schema.ts":
      return (
        /export const ReadyResponseSchema\s*=\s*Schema\.Object\(/.test(
          content,
        ) &&
        /checks:\s*Schema\.Record\(/.test(content) &&
        ["ready", "unavailable", "ok", "failed"].every((value) => {
          return content.includes(`Schema.Const("${value}")`);
        })
      );
    case "apps/server/src/services/database-readiness.boot.ts":
      return (
        /registerReadinessCheck\(["']database["']\s*,/.test(content) &&
        (/await \$mongo\.command\(\{\s*ping:\s*1\s*\}\)/.test(content) ||
          /await sql`select 1`\.execute\(\$db\)/.test(content))
      );
    case "apps/server/src/services/redis-readiness.boot.ts":
      return (
        /registerReadinessCheck\(["']redis["']\s*,/.test(content) &&
        /await \$redis\.ping\(\)/.test(content)
      );
    case "apps/server/src/services/database-readiness.test.ts":
      return (
        content.includes("DatabaseReadinessBoot.handler(") &&
        content.includes("runReadinessChecks()") &&
        content.includes('database: "failed"')
      );
    case "apps/server/src/services/redis-readiness.test.ts":
      return (
        content.includes('"/ready"') &&
        content.includes('database: "ok"') &&
        content.includes('redis: "ok"')
      );
    case "apps/web/tsconfig.json":
      return (
        content.includes('"react-jsx"') &&
        content.includes('".next/dev/types/**/*.ts"')
      );
    default:
      return false;
  }
}

function readPrettierOptions(projectDir: string): PrettierOptions {
  const path = join(projectDir, ".prettierrc");
  if (!existsSync(path)) return {};
  try {
    const options: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isPlainObject(options)) return {};
    return { ...options, plugins: [] };
  } catch {
    return {};
  }
}

function restoreIgnoreFiles(
  projectDir: string,
  templatesDir: string,
): string[] {
  if (existsSync(join(projectDir, ".gitignore"))) return [];
  const restored: string[] = [];
  for (const relPath of ["_gitignore", "apps/server/_gitignore"]) {
    const dstRel = join(dirname(relPath), targetName(basename(relPath)));
    const dstPath = join(projectDir, dstRel);
    if (existsSync(dstPath)) continue;
    mkdirSync(dirname(dstPath), { recursive: true });
    writeFileSync(dstPath, readFileSync(join(templatesDir, "base", relPath)));
    restored.push(dstRel);
  }
  log.info(
    `Restored ignore files before checking the working tree: ${restored.join(", ")}.`,
  );
  return restored;
}

async function upgradeReleasePrerequisites(
  selections: Selections,
  ctx: ApplyContext,
): Promise<void> {
  const prerequisites: [string, string, string][] = [
    [
      "base",
      "_gitignore",
      "ignore local secrets, dependencies and generated build artefacts",
    ],
    [
      "base",
      "apps/server/_gitignore",
      "ignore generated local server commands",
    ],
    [
      "base",
      "Dockerfile.server",
      "start the production server and embed version and commit",
    ],
    [
      selections.workers ? "server/workers" : "base",
      "apps/server/process.config.js",
      "default each PM2 process to one instance",
    ],
    [
      "base",
      "apps/server/src/app/process-config.test.ts",
      "assert the PM2 instance default",
    ],
    [
      "base",
      "apps/server/src/handlers/ping.route.ts",
      "report version and commit without logging the environment",
    ],
    [
      "base",
      "apps/server/src/handlers/ping.test.ts",
      "assert the release health response",
    ],
    [
      "base",
      "apps/shared/lib/src/schemas/api/ping-response.schema.ts",
      "type the release health metadata",
    ],
    [
      `db/${selections.database}`,
      "apps/server/src/utils/env.ts",
      "read the release version and commit",
    ],
    [
      `frontend/${selections.frontend}`,
      "Dockerfile.web",
      "build the web image with release labels and the correct working directory",
    ],
  ];
  if (selections.frontend === "nextjs") {
    prerequisites.push([
      "frontend/nextjs",
      "apps/web/tsconfig.json",
      "keep Next.js builds from rewriting the TypeScript configuration",
    ]);
  }
  for (const [fragment, relPath, description] of prerequisites) {
    await upgradePrerequisite(fragment, relPath, description, ctx);
  }
  await upgradeReadinessPrerequisites(selections, ctx);
  const formatPaths = [
    "README.md",
    "turbo.json",
    ".claude/skills/code-review/references/crap-and-mutation.md",
    ".claude/skills/code-review/references/mutation-testing.md",
    "apps/server/src/handlers/auth/password-reset-token.ts",
    ...(!selections.rateLimit
      ? ["apps/server/src/middleware/rate-limit.ts"]
      : []),
    "apps/server/src/test/db-helpers.ts",
    ...(selections.frontend === "tanstack"
      ? [
          "apps/web/src/routes/forgot-password.tsx",
          "apps/web/src/routes/login.tsx",
          "apps/web/src/routes/register.tsx",
          "apps/web/src/components/ui/button.tsx",
        ]
      : [
          "apps/web/app/login/page.tsx",
          "apps/web/app/register/page.tsx",
          "apps/web/hooks/use-auth.tsx",
          "apps/web/components/ui/button.tsx",
        ]),
  ];
  for (const relPath of formatPaths) {
    await upgradePrerequisite(
      "",
      relPath,
      "apply the generated Prettier configuration for the CI format gate",
      ctx,
      true,
    );
  }
}

async function upgradeRateLimitPrerequisites(
  selections: Selections,
  ctx: ApplyContext,
): Promise<void> {
  if (!selections.rateLimit) return;
  for (const [fragment, relPath] of [
    [`db/${selections.database}`, "apps/server/src/utils/env.ts"],
    ["base", "apps/server/src/utils/env.test.ts"],
    ["server/rate-limit", "apps/server/src/middleware/rate-limit.ts"],
    ["server/rate-limit", "apps/server/src/middleware/rate-limit.test.ts"],
  ]) {
    await upgradePrerequisite(
      fragment,
      relPath,
      "allow and test disabling rate limiting for the CI gate",
      { ...ctx, selections },
    );
  }
}

async function upgradeReadinessPrerequisites(
  selections: Selections,
  ctx: ApplyContext,
): Promise<void> {
  const prerequisites: [string, string, string][] = [
    ...[
      "apps/server/src/app/readiness.ts",
      "apps/server/src/app/readiness.test.ts",
      "apps/server/src/handlers/ready.route.ts",
      "apps/server/src/handlers/ready.test.ts",
      "apps/shared/lib/src/schemas/api/ready-response.schema.ts",
    ].map((path): [string, string, string] => [
      "base",
      path,
      "provide the readiness registry, endpoint and checks",
    ]),
    [
      `db/${selections.database}`,
      "apps/server/src/services/database-readiness.boot.ts",
      "register the database readiness check",
    ],
    [
      `db/${selections.database}`,
      "apps/server/src/services/database-readiness.test.ts",
      "test the database readiness check",
    ],
  ];
  if (
    selections.workers ||
    selections.cache ||
    selections.rateLimit ||
    selections.websockets
  ) {
    for (const path of [
      "apps/server/src/services/redis-readiness.boot.ts",
      "apps/server/src/services/redis-readiness.test.ts",
    ]) {
      prerequisites.push([
        "server/redis",
        path,
        "register and test the Redis readiness check",
      ]);
    }
  }
  for (const [fragment, relPath, description] of prerequisites) {
    await upgradePrerequisite(fragment, relPath, description, ctx);
  }
}

function reportReleaseReadiness(projectDir: string): void {
  if (!existsSync(join(projectDir, "package-lock.json"))) {
    log.warn(
      "Missing package-lock.json: run npm install and commit the lockfile before your first release.",
    );
  }
  const branch = execFileSync("git", ["branch", "--show-current"], {
    cwd: projectDir,
    encoding: "utf8",
  }).trim();
  if (branch !== "main") {
    log.warn(
      `Current branch is ${branch || "detached HEAD"}; releases require main. The branch was left unchanged.`,
    );
  }
}

function fail(message: string): never {
  cancel(message);
  process.exit(1);
}

function assertCleanGitTree(
  projectDir: string,
  force: boolean,
  release = false,
  restored: string[] = [],
): void {
  if (force) return;
  try {
    const out = execFileSync(
      "git",
      [
        "status",
        "--porcelain",
        "--",
        ".",
        ...restored.map((path) => {
          return `:(exclude)${path.replaceAll("\\", "/")}`;
        }),
      ],
      {
        cwd: projectDir,
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).toString();
    if (out.trim().length > 0) {
      fail(
        release
          ? "Working tree is not clean. Commit or stash before adding or refreshing CI; --force cannot bypass this check."
          : "Working tree is not clean — commit or stash first so the add is reviewable with git diff (or pass --force).",
      );
    }
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) {
      fail(
        release
          ? "Not a git repository. Adding or refreshing CI requires a clean git tree."
          : "Not a git repository — add mode relies on git for reviewable, revertible changes (or pass --force).",
      );
    }
    fail(
      release
        ? "Could not run git. Adding or refreshing CI requires a clean git tree."
        : "Could not run git — add mode relies on git for reviewable, revertible changes (or pass --force).",
    );
  }
}

async function walkFragment(
  fragmentDir: string,
  relDir: string,
  ctx: ApplyContext,
): Promise<void> {
  for (const entry of readdirSync(join(fragmentDir, relDir), {
    withFileTypes: true,
  })) {
    if (IGNORE_ENTRIES.has(entry.name)) continue;

    const relPath = relDir ? join(relDir, entry.name) : entry.name;
    if (ctx.refresh && isProjectOwnedReleaseFile(relPath)) continue;
    if (entry.isDirectory()) {
      await walkFragment(fragmentDir, relPath, ctx);
    } else if (entry.isFile()) {
      await applyFile(fragmentDir, relPath, ctx);
    }
  }
}

function releaseSettings(
  relPath: string,
  content: string,
  ctx: ApplyContext,
): string {
  if (
    ctx.maintainersOnly === undefined ||
    relPath.replaceAll("\\", "/") !== RELEASE_CONFIG
  ) {
    return content;
  }
  return setMaintainersOnly(content, ctx.maintainersOnly);
}

async function applyFile(
  fragmentDir: string,
  relPath: string,
  ctx: ApplyContext,
): Promise<void> {
  const srcPath = join(fragmentDir, relPath);
  const dstRel = join(dirname(relPath), targetName(basename(relPath)));
  const dstPath = join(ctx.projectDir, dstRel);

  if (basename(relPath) === "package.json" && existsSync(dstPath)) {
    mergePackageJsonAdditive(srcPath, dstPath, relPath, ctx);
    return;
  }

  if (BINARY_EXTENSIONS.has(extname(relPath).toLowerCase())) {
    const incoming = readFileSync(srcPath);
    if (!existsSync(dstPath)) {
      mkdirSync(dirname(dstPath), { recursive: true });
      writeFileSync(dstPath, incoming);
      ctx.report.written.push(dstRel);
    } else if (incoming.equals(readFileSync(dstPath))) {
      ctx.report.identical.push(dstRel);
    } else if (ctx.refresh) {
      writeFileSync(dstPath, incoming);
      ctx.report.written.push(dstRel);
    } else {
      writeFileSync(dstPath + ".new", incoming);
      ctx.report.conflicts.push(dstRel);
    }
    return;
  }

  const incoming = applyReplacements(
    releaseSettings(relPath, readFileSync(srcPath, "utf8"), ctx),
    ctx.replacements,
  );

  if (!existsSync(dstPath)) {
    mkdirSync(dirname(dstPath), { recursive: true });
    writeFileSync(dstPath, incoming);
    ctx.report.written.push(dstRel);
    return;
  }

  const onDisk = readFileSync(dstPath, "utf8");
  if (onDisk === incoming) {
    ctx.report.identical.push(dstRel);
    return;
  }

  if (ctx.refresh || (await isPristine(relPath, onDisk, ctx))) {
    writeFileSync(dstPath, incoming);
    ctx.report.written.push(dstRel);
    return;
  }

  writeFileSync(dstPath + ".new", incoming);
  ctx.report.conflicts.push(dstRel);
}

function mergePackageJsonAdditive(
  srcPath: string,
  dstPath: string,
  relPath: string,
  ctx: ApplyContext,
): void {
  const partial = JSON.parse(
    applyReplacements(readFileSync(srcPath, "utf8"), ctx.replacements),
  ) as JsonRecord;
  const target = JSON.parse(readFileSync(dstPath, "utf8")) as JsonRecord;
  let changed = false;

  const walk = (t: JsonRecord, p: JsonRecord, path: string[]): void => {
    for (const key of Object.keys(p)) {
      const partialValue = p[key];
      const targetValue = t[key];
      if (isPlainObject(partialValue) && isPlainObject(targetValue)) {
        walk(targetValue, partialValue, [...path, key]);
      } else if (targetValue === undefined) {
        t[key] = partialValue;
        changed = true;
        ctx.report.pkgAdded.push(`${relPath}: ${[...path, key].join(".")}`);
      } else if (JSON.stringify(targetValue) !== JSON.stringify(partialValue)) {
        ctx.report.pkgKept.push(
          `${relPath}: ${[...path, key].join(".")} kept as ${JSON.stringify(targetValue)} (fragment has ${JSON.stringify(partialValue)})`,
        );
      }
    }
  };

  walk(target, partial, []);
  if (changed) {
    writeFileSync(dstPath, JSON.stringify(target, null, 4) + "\n");
  }
}

function normaliseGeneratedContent(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+$/, ""))
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(
      /^([ ]*)test:\n\1 {4}\[\n\1 {8}"CMD-SHELL",\n\1 {8}"(pg_isready -U postgres -d [a-z0-9_]+)",?\n\1 {4}\]$/gm,
      '$1test: ["CMD-SHELL", "$2"]',
    );
}

function generatedBlockPattern(block: string): RegExp {
  const pattern = normaliseGeneratedContent(block)
    .split("\n")
    .map((line) => line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\t ]*\\r?\\n(?:[\\t ]*\\r?\\n)*");
  return new RegExp(`^${pattern}[\\t ]*\\r?$`, "m");
}

function updateGeneratedFile(
  filePath: string,
  before: string,
  after: string,
  relPath: string,
  report: ApplyReport,
): void {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, after);
    report.written.push(relPath);
    return;
  }

  const onDisk = readFileSync(filePath, "utf8");
  if (onDisk === after) {
    report.identical.push(relPath);
    return;
  }
  if (normaliseGeneratedContent(onDisk) === normaliseGeneratedContent(before)) {
    writeFileSync(filePath, after);
    report.written.push(relPath);
    return;
  }

  if (before === after) return;
  writeFileSync(filePath + ".new", after);
  report.conflicts.push(relPath);
}

function updateRootPackage(projectDir: string, cliVersion: string): void {
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as JsonRecord;
  const devDeps = isPlainObject(pkg.devDependencies) ? pkg.devDependencies : {};
  devDeps["create-pimasi-app"] = `^${cliVersion}`;
  pkg.devDependencies = devDeps;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + "\n");
}

export async function runAdd(options: AddOptions): Promise<void> {
  intro(pc.inverse(pc.cyan(" pimasi add ")));

  const manifest = readManifest(options.projectDir);
  if (!manifest) {
    fail(
      `No ${MANIFEST_FILENAME} found here — run inside a project scaffolded by create-pimasi-app 0.2.0+.`,
    );
  }

  const cliVersion = getCliVersion();
  if (manifest.cliVersion !== cliVersion) {
    log.info(
      `Project scaffolded with CLI ${manifest.cliVersion}; adding with ${cliVersion}.`,
    );
  }

  const before = manifestToSelections(manifest);
  const offAxes: AddFeature[] = SERVER_AXES.filter(
    (axis) => !before[AXIS_KEY[axis]],
  );
  if (before.ci === "none") offAxes.push("ci-github", "ci-gitlab");

  let axes = [...new Set(options.axes)];
  if (axes.length === 0) {
    if (options.refresh) fail("Specify the current CI host with --refresh.");
    if (offAxes.length === 0) {
      outro("All addable features are already enabled.");
      return;
    }
    if (options.yes) {
      fail(`Specify at least one feature: pimasi add <${offAxes.join("|")}>`);
    }
    const answer = await multiselect({
      message: "Which features do you want to add?",
      options: offAxes.map((axis) => ({
        value: axis,
        label: axis,
        hint: AXIS_HINTS[axis],
      })),
      required: true,
    });
    if (isCancel(answer)) {
      cancel("Cancelled.");
      process.exit(0);
    }
    axes = answer as AddFeature[];
  }

  const ciFeatures = axes.filter(isCiFeature);
  if (ciFeatures.length > 1) fail("Choose one CI host.");
  const ciFeature = ciFeatures[0];
  const ciHost = ciFeature === "ci-github" ? "github" : "gitlab";
  if (options.refresh) {
    if (!ciFeature || axes.length !== 1 || before.ci !== ciHost) {
      fail(
        "Refresh requires only ci-<host> matching the project's current CI host.",
      );
    }
  } else if (ciFeature && before.ci !== "none") {
    fail(
      "A CI host is already set. Switching hosts is a migration; use --refresh to update the current host.",
    );
  }
  if (
    options.maintainersOnly !== undefined &&
    (!ciFeature || options.refresh)
  ) {
    fail(
      "--maintainers-only and --no-maintainers-only apply only when adding ci-github or ci-gitlab, not to refresh or server features.",
    );
  }
  let maintainersOnly = options.maintainersOnly;
  if (ciFeature && !options.refresh && maintainersOnly === undefined) {
    if (!options.yes && !process.stdin.isTTY) {
      log.info(
        'No terminal to ask "Only Maintainers can release?", so add uses the default, yes; pass --maintainers-only or --no-maintainers-only to choose.',
      );
    }
    const answer =
      options.yes || !process.stdin.isTTY
        ? true
        : await confirm({
            message: "Only Maintainers can release?",
            initialValue: true,
          });
    if (isCancel(answer)) {
      cancel("Cancelled.");
      process.exit(0);
    }
    maintainersOnly = answer;
  }

  axes = axes.filter((axis) => {
    if (isCiFeature(axis)) return true;
    if (!before[AXIS_KEY[axis]]) return true;
    log.warn(`${axis} is already enabled, skipping.`);
    return false;
  });
  if (axes.length === 0) {
    outro("Nothing to add.");
    return;
  }

  const templatesDir = findTemplatesDir();
  const restored =
    ciFeature && !options.refresh
      ? restoreIgnoreFiles(options.projectDir, templatesDir)
      : [];
  assertCleanGitTree(
    options.projectDir,
    ciFeature ? false : options.force,
    Boolean(ciFeature),
    restored,
  );

  const after: Selections = { ...before };
  for (const axis of axes) {
    if (isCiFeature(axis)) after.ci = ciHost;
    else after[AXIS_KEY[axis]] = true;
  }

  const replacements = buildReplacements(manifest.name);
  const ctx: ApplyContext = {
    projectDir: options.projectDir,
    templatesDir,
    pristineFragments: selectedFragments(before),
    selections: before,
    refresh: options.refresh,
    replacements,
    maintainersOnly,
    prettierOptions: readPrettierOptions(options.projectDir),
    report: {
      written: [],
      identical: [],
      conflicts: [],
      pkgAdded: [],
      pkgKept: [],
      upgraded: [],
      mergeBeforeRelease: [],
    },
  };

  const fragments: string[] = [];
  const redisFragBefore =
    before.workers || before.cache || before.rateLimit || before.websockets;
  const redisFragAfter =
    after.workers || after.cache || after.rateLimit || after.websockets;
  if (
    !options.refresh &&
    redisFragAfter &&
    (!redisFragBefore ||
      !existsSync(
        join(options.projectDir, "apps/server/src/services/redis.ts"),
      ))
  ) {
    fragments.push("server/redis");
  }
  if (after.rateLimit && !before.rateLimit) {
    fragments.push("server/rate-limit");
  }
  if (after.workers && !before.workers) {
    fragments.push("server/workers");
  }
  if (after.cache && !before.cache) {
    fragments.push("server/cache");
  }
  if (after.websockets && !before.websockets) {
    fragments.push("websockets/server");
    fragments.push(`websockets/${manifest.frontend}`);
  }

  if (ciFeature) fragments.push("ci/common", `ci/${ciHost}`);

  const s = spinner();
  s.start(`${options.refresh ? "Refreshing" : "Adding"} ${axes.join(" + ")}`);
  if (ciFeature) {
    if (!options.refresh) await upgradeReleasePrerequisites(after, ctx);
  } else if (fragments.includes("server/redis")) {
    await upgradeReadinessPrerequisites(after, ctx);
  }
  if (ciFeature || fragments.includes("server/rate-limit")) {
    await upgradeRateLimitPrerequisites(after, ctx);
  }
  for (const fragment of fragments) {
    await walkFragment(join(templatesDir, fragment), "", ctx);
  }

  if (!options.refresh) {
    updateGeneratedFile(
      join(options.projectDir, "docker-compose.yml"),
      renderDockerCompose(before),
      renderDockerCompose(after),
      "docker-compose.yml",
      ctx.report,
    );
    updateGeneratedFile(
      join(options.projectDir, ".env.example"),
      renderEnvExample(before),
      renderEnvExample(after),
      ".env.example",
      ctx.report,
    );
  }

  let stackBlockForManualPaste: string | null = null;
  const readmePath = join(options.projectDir, "README.md");
  if (!options.refresh && existsSync(readmePath)) {
    const content = readFileSync(readmePath, "utf8");
    const oldBlock = renderStackBlock(before);
    const newBlock = renderStackBlock(after);
    const oldPattern = generatedBlockPattern(oldBlock);
    if (generatedBlockPattern(newBlock).test(content)) {
      ctx.report.identical.push("README.md (## Stack)");
    } else if (oldPattern.test(content)) {
      writeFileSync(readmePath, content.replace(oldPattern, newBlock.trim()));
      ctx.report.written.push("README.md (## Stack)");
    } else {
      stackBlockForManualPaste = newBlock;
      ctx.report.conflicts.push("README.md (## Stack — paste manually)");
    }
  }

  if (!options.refresh) {
    const rootPackage = join(options.projectDir, "package.json");
    const previousPackage = existsSync(rootPackage)
      ? readFileSync(rootPackage, "utf8")
      : null;
    updateRootPackage(options.projectDir, cliVersion);
    if (
      previousPackage !== null &&
      readFileSync(rootPackage, "utf8") !== previousPackage
    ) {
      ctx.report.written.push("package.json");
    }
  }
  const manifestPath = join(options.projectDir, MANIFEST_FILENAME);
  const previousManifest = readFileSync(manifestPath, "utf8");
  writeManifest(options.projectDir, after, cliVersion);
  if (readFileSync(manifestPath, "utf8") !== previousManifest) {
    ctx.report.written.push(MANIFEST_FILENAME);
  }

  s.stop(
    `${options.refresh ? "Refreshed" : "Added"} ${pc.bold(axes.join(" + "))}`,
  );

  const { report } = ctx;
  if (report.written.length > 0) {
    log.success(
      `Wrote ${report.written.length} file(s):\n${report.written.map((f) => `  ${f}`).join("\n")}`,
    );
  }
  if (report.upgraded.length > 0) {
    log.success(
      `Upgraded ${ciFeature ? "release " : ""}prerequisites:\n${report.upgraded.map((f) => `  ${f}`).join("\n")}`,
    );
  }
  if (report.mergeBeforeRelease.length > 0) {
    note(
      report.mergeBeforeRelease.join("\n"),
      ciFeature
        ? "Merge before your first gate run or release"
        : "Merge before building",
    );
  }
  if (ciFeature) reportReleaseReadiness(options.projectDir);
  if (report.pkgAdded.length > 0) {
    log.info(
      `package.json additions:\n${report.pkgAdded.map((f) => `  ${f}`).join("\n")}`,
    );
  }
  if (report.pkgKept.length > 0) {
    log.warn(
      `Existing package.json values kept:\n${report.pkgKept.map((f) => `  ${f}`).join("\n")}`,
    );
  }
  if (report.conflicts.length > 0) {
    log.warn(
      `Local edits detected — review the .new files:\n${report.conflicts.map((f) => `  ${f}`).join("\n")}`,
    );
  }
  if (stackBlockForManualPaste) {
    note(stackBlockForManualPaste.trim(), "Update ## Stack in README.md");
  }

  if (options.install) {
    try {
      log.step("Installing dependencies (npm install)…");
      execFileSync("npm", ["install"], {
        cwd: options.projectDir,
        stdio: "inherit",
      });
    } catch {
      log.warn("npm install failed — run it manually.");
    }
  }

  const steps = [
    "git diff — review what changed",
    ...(options.install ? [] : ["npm install"]),
    "make dev",
    ...(axes.includes("websockets")
      ? ["mount <WebSocketProvider> in the app shell (see README)"]
      : []),
  ];
  note(steps.join("\n"), "Next steps");
  outro(pc.green("Done."));
}
