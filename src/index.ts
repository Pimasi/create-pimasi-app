#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import pc from "picocolors";
import { ADD_FEATURES, runAdd, type AddFeature } from "./add.js";
import {
  buildReplacements,
  compose,
  RELEASE_CONFIG,
  replacePlaceholders,
  setMaintainersOnly,
} from "./compose.js";
import { runEnv } from "./env.js";
import {
  injectStackBlock,
  MANIFEST_FILENAME,
  renderDockerCompose,
  renderEnvExample,
  writeManifest,
} from "./generate.js";
import { findTemplatesDir, getCliVersion } from "./templates.js";
import {
  type Ci,
  type Database,
  type Design,
  type Frontend,
  type Selections,
} from "./types.js";

const DEFAULT_NAME = "my-pimasi-app";
const FRONTENDS = ["tanstack", "nextjs"] as const;
const DATABASES = ["mongo", "postgres"] as const;
const DESIGNS = ["shadcn", "bespoke"] as const;
const CI_HOSTS = ["github", "gitlab", "none"] as const;
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateName(value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) return "Project name is required";
  if (!KEBAB_RE.test(value)) {
    return "Use kebab-case (lowercase letters, digits, single dashes)";
  }
  return undefined;
}

function isFrontend(value: string): value is Frontend {
  return (FRONTENDS as readonly string[]).includes(value);
}

function isDatabase(value: string): value is Database {
  return (DATABASES as readonly string[]).includes(value);
}

function isDesign(value: string): value is Design {
  return (DESIGNS as readonly string[]).includes(value);
}

function isCi(value: string): value is Ci {
  return (CI_HOSTS as readonly string[]).includes(value);
}

function ensureNotCancelled(value: unknown): void {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }
}

function fail(message: string): never {
  cancel(message);
  process.exit(1);
}

async function resolveOption<T>(
  flagValue: T | undefined,
  isYes: boolean,
  defaultValue: T,
  promptFn: () => Promise<T>,
): Promise<T> {
  if (flagValue !== undefined) return flagValue;
  if (isYes) return defaultValue;
  return promptFn();
}

function printHelp(): void {
  console.log(
    [
      `create-pimasi-app — scaffold a full-stack PIMASI monorepo`,
      ``,
      `Usage:`,
      `  npm create pimasi-app@latest -- [name] [options]`,
      `  npx create-pimasi-app [name] [options]`,
      `  npx pimasi add [feature…]     Add features to an existing`,
      `                                project (reads pimasi.json; features:`,
      `                                ${ADD_FEATURES.join(", ")})`,
      `  npx pimasi env list           List project environments`,
      `  npx pimasi env add <name>     Create an independent environment`,
      `    [--after <environment> | --before <environment>] [--on-merge]`,
      `    [--publish] [--yes]`,
      `  npx pimasi env remove <name> [--keep-host] [--yes]`,
      ``,
      `Options:`,
      `  --name <slug>                 App name (kebab-case; becomes the package`,
      `                                scope — imports read @<name>/lib/...)`,
      `  --dir <path>                  Target directory (default ./<name>)`,
      `  --frontend <tanstack|nextjs>  Frontend framework`,
      `  --db <mongo|postgres>         Database (postgres uses Kysely)`,
      `  --design <shadcn|bespoke>     Design system for apps/web`,
      `  --ci <github|gitlab|none>     CI and releases (default none)`,
      `  --maintainers-only / --no-maintainers-only`,
      `                                Only Maintainers can release (github or`,
      `                                gitlab; default on; also add ci-<host>)`,
      `  --cordova / --no-cordova      Toggle Cordova mobile packaging`,
      `  --workers / --no-workers      Toggle BullMQ background workers + queues`,
      `  --cache / --no-cache          Toggle the Redis-backed $cache service`,
      `  --rate-limit / --no-rate-limit  Toggle Redis-backed rate limiting`,
      `  --websockets / --no-websockets  Toggle realtime WebSocket push`,
      `                                  (Redis-backed $bus)`,
      `  --yes, -y                     Non-interactive; use flags + defaults`,
      `  --no-install                  Skip npm install`,
      `  --no-git                      Skip git init`,
      `  --force                       Allow a non-empty target directory`,
      `  --refresh                     Refresh the installed CI host (add only)`,
      `  --help, -h                    Show this help`,
    ].join("\n"),
  );
}

function finaliseRootPackage(
  targetDir: string,
  slug: string,
  cliVersion: string,
): void {
  const pkgPath = join(targetDir, "package.json");
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<
    string,
    unknown
  >;
  pkg.name = slug;
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
  devDeps["create-pimasi-app"] = `^${cliVersion}`;
  pkg.devDependencies = devDeps;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + "\n");
}

function isAddFeature(value: string): value is AddFeature {
  return (ADD_FEATURES as readonly string[]).includes(value);
}

function tryGitInit(targetDir: string): void {
  try {
    execFileSync("git", ["init", "-b", "main"], {
      cwd: targetDir,
      stdio: "ignore",
    });
  } catch {
    try {
      execFileSync("git", ["init"], { cwd: targetDir, stdio: "ignore" });
      execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/main"], {
        cwd: targetDir,
        stdio: "ignore",
      });
    } catch {
      log.warn("git init skipped (git not available).");
    }
  }
}

function tryNpmInstall(targetDir: string): void {
  try {
    log.step("Installing dependencies (npm install)…");
    execFileSync("npm", ["install"], { cwd: targetDir, stdio: "inherit" });
  } catch {
    log.warn("npm install failed — run it manually inside the project.");
  }
}

function displayPath(targetDir: string): string {
  const rel = relative(process.cwd(), targetDir);
  return rel && !rel.startsWith("..") ? rel : targetDir;
}

async function main(): Promise<void> {
  if (process.argv[2] === "env") {
    await runEnv(process.argv.slice(3), process.cwd());
    return;
  }

  const parsed = (() => {
    try {
      return parseArgs({
        args: process.argv.slice(2),
        allowPositionals: true,
        strict: true,
        options: {
          name: { type: "string" },
          frontend: { type: "string" },
          db: { type: "string" },
          design: { type: "string" },
          ci: { type: "string" },
          dir: { type: "string" },
          cordova: { type: "boolean" },
          "no-cordova": { type: "boolean" },
          workers: { type: "boolean" },
          "no-workers": { type: "boolean" },
          cache: { type: "boolean" },
          "no-cache": { type: "boolean" },
          "rate-limit": { type: "boolean" },
          "no-rate-limit": { type: "boolean" },
          websockets: { type: "boolean" },
          "no-websockets": { type: "boolean" },
          "maintainers-only": { type: "boolean" },
          "no-maintainers-only": { type: "boolean" },
          "no-install": { type: "boolean" },
          "no-git": { type: "boolean" },
          yes: { type: "boolean", short: "y" },
          force: { type: "boolean" },
          refresh: { type: "boolean" },
          help: { type: "boolean", short: "h" },
        },
      });
    } catch (err) {
      console.error((err as Error).message);
      printHelp();
      process.exit(1);
    }
  })();

  const { values, positionals } = parsed;

  if (values.help) {
    printHelp();
    return;
  }

  const isYes = Boolean(values.yes);
  const maintainersOnlyFlag = values["maintainers-only"]
    ? true
    : values["no-maintainers-only"]
      ? false
      : undefined;

  const wantsAdd =
    positionals[0] === "add" ||
    (positionals.length === 0 &&
      values.name === undefined &&
      values.dir === undefined &&
      existsSync(join(process.cwd(), MANIFEST_FILENAME)));

  if (wantsAdd) {
    const scaffoldOnly = [
      "name",
      "frontend",
      "db",
      "design",
      "ci",
      "dir",
      "cordova",
      "no-cordova",
      "workers",
      "no-workers",
      "cache",
      "no-cache",
      "rate-limit",
      "no-rate-limit",
      "websockets",
      "no-websockets",
      "no-git",
    ].filter((key) => (values as Record<string, unknown>)[key] !== undefined);
    if (scaffoldOnly.length > 0) {
      console.error(
        `--${scaffoldOnly[0]} is not valid with add — name features as arguments: pimasi add ${ADD_FEATURES.join(" ")}`,
      );
      process.exit(1);
    }

    const rawAxes = positionals[0] === "add" ? positionals.slice(1) : [];
    const axes: AddFeature[] = [];
    for (const raw of rawAxes) {
      if (!isAddFeature(raw)) {
        console.error(
          `Unknown feature "${raw}" — valid features: ${ADD_FEATURES.join(", ")}`,
        );
        process.exit(1);
      }
      axes.push(raw);
    }

    await runAdd({
      axes,
      yes: isYes,
      force: Boolean(values.force),
      refresh: Boolean(values.refresh),
      install: !values["no-install"],
      projectDir: process.cwd(),
      maintainersOnly: maintainersOnlyFlag,
    });
    return;
  }

  if (values.refresh) fail("--refresh is only valid with add ci-<host>.");

  intro(pc.inverse(pc.cyan(" create-pimasi-app ")));

  const nameFlag = values.name ?? positionals[0];
  const slug = await resolveOption<string>(
    nameFlag,
    isYes,
    DEFAULT_NAME,
    async () => {
      const answer = await text({
        message: "App name? (becomes the package scope: @<name>/lib)",
        placeholder: DEFAULT_NAME,
        defaultValue: DEFAULT_NAME,
        validate: validateName,
      });
      ensureNotCancelled(answer);
      return answer as string;
    },
  );

  const nameError = validateName(slug);
  if (nameError) fail(`Invalid project name "${slug}": ${nameError}`);

  if (values.frontend !== undefined && !isFrontend(values.frontend)) {
    fail(`Invalid --frontend "${values.frontend}" (use tanstack|nextjs).`);
  }
  const frontend = await resolveOption<Frontend>(
    values.frontend as Frontend | undefined,
    isYes,
    "tanstack",
    async () => {
      const answer = await select({
        message: "Frontend framework?",
        options: [
          {
            value: "tanstack",
            label: "TanStack Router SPA",
            hint: "React 19 + Vite",
          },
          {
            value: "nextjs",
            label: "Next.js",
            hint: "App Router — API client",
          },
        ],
        initialValue: "tanstack",
      });
      ensureNotCancelled(answer);
      return answer as Frontend;
    },
  );

  const cordovaFlag = values.cordova
    ? true
    : values["no-cordova"]
      ? false
      : undefined;
  const cordova = await resolveOption<boolean>(
    cordovaFlag,
    isYes,
    false,
    async () => {
      const answer = await confirm({
        message: "Add Cordova mobile packaging?",
        initialValue: false,
      });
      ensureNotCancelled(answer);
      return answer as boolean;
    },
  );

  if (values.db !== undefined && !isDatabase(values.db)) {
    fail(`Invalid --db "${values.db}" (use mongo|postgres).`);
  }
  const database = await resolveOption<Database>(
    values.db as Database | undefined,
    isYes,
    "mongo",
    async () => {
      const answer = await select({
        message: "Database?",
        options: [
          { value: "mongo", label: "MongoDB", hint: "MongoDB driver" },
          {
            value: "postgres",
            label: "PostgreSQL",
            hint: "uses Kysely",
          },
        ],
        initialValue: "mongo",
      });
      ensureNotCancelled(answer);
      return answer as Database;
    },
  );

  const workersFlag = values.workers
    ? true
    : values["no-workers"]
      ? false
      : undefined;
  const workers = await resolveOption<boolean>(
    workersFlag,
    isYes,
    false,
    async () => {
      const answer = await confirm({
        message: "Does the project need backend workers? (BullMQ + Redis)",
        initialValue: false,
      });
      ensureNotCancelled(answer);
      return answer as boolean;
    },
  );

  const cacheFlag = values.cache
    ? true
    : values["no-cache"]
      ? false
      : undefined;
  const cache = await resolveOption<boolean>(
    cacheFlag,
    isYes,
    true,
    async () => {
      const answer = await confirm({
        message: "Does the project need Redis for caching? ($cache service)",
        initialValue: true,
      });
      ensureNotCancelled(answer);
      return answer as boolean;
    },
  );

  const rateLimitFlag = values["rate-limit"]
    ? true
    : values["no-rate-limit"]
      ? false
      : undefined;
  const rateLimit = await resolveOption<boolean>(
    rateLimitFlag,
    isYes,
    true,
    async () => {
      const answer = await confirm({
        message:
          "Does the project need rate limiting? (Redis-backed, protects auth routes)",
        initialValue: true,
      });
      ensureNotCancelled(answer);
      return answer as boolean;
    },
  );

  const websocketsFlag = values.websockets
    ? true
    : values["no-websockets"]
      ? false
      : undefined;
  const websockets = await resolveOption<boolean>(
    websocketsFlag,
    isYes,
    false,
    async () => {
      const answer = await confirm({
        message:
          "Does the project need WebSockets? (realtime push over the Redis-backed $bus)",
        initialValue: false,
      });
      ensureNotCancelled(answer);
      return answer as boolean;
    },
  );

  if (values.design !== undefined && !isDesign(values.design)) {
    fail(`Invalid --design "${values.design}" (use shadcn|bespoke).`);
  }
  const design = await resolveOption<Design>(
    values.design as Design | undefined,
    isYes,
    "shadcn",
    async () => {
      const answer = await select({
        message: "Design system?",
        options: [
          {
            value: "shadcn",
            label: "shadcn/ui",
            hint: "standard tokens, light+dark, components.json",
          },
          {
            value: "bespoke",
            label: "Bespoke tokens",
            hint: "in-house dark palette, zero extra deps",
          },
        ],
        initialValue: "shadcn",
      });
      ensureNotCancelled(answer);
      return answer as Design;
    },
  );

  if (values.ci !== undefined && !isCi(values.ci)) {
    fail(`Invalid --ci "${values.ci}" (use github|gitlab|none).`);
  }
  const ci = await resolveOption<Ci>(
    values.ci as Ci | undefined,
    isYes,
    "none",
    async () => {
      const answer = await select({
        message: "CI and releases",
        options: [
          { value: "github", label: "GitHub" },
          { value: "gitlab", label: "GitLab" },
          { value: "none", label: "None" },
        ],
        initialValue: "none",
      });
      ensureNotCancelled(answer);
      return answer as Ci;
    },
  );

  if (ci === "none" && maintainersOnlyFlag !== undefined) {
    fail(
      "--maintainers-only and --no-maintainers-only need --ci github or --ci gitlab.",
    );
  }
  const maintainersOnly =
    ci === "none"
      ? false
      : await resolveOption<boolean>(
          maintainersOnlyFlag,
          isYes,
          true,
          async () => {
            const answer = await confirm({
              message: "Only Maintainers can release?",
              initialValue: true,
            });
            ensureNotCancelled(answer);
            return answer as boolean;
          },
        );

  const defaultDir = `./${slug}`;
  const targetInput = await resolveOption<string>(
    values.dir,
    isYes,
    defaultDir,
    async () => {
      const answer = await text({
        message: "Target directory?",
        placeholder: defaultDir,
        defaultValue: defaultDir,
      });
      ensureNotCancelled(answer);
      return (answer as string) || defaultDir;
    },
  );

  const targetDir = isAbsolute(targetInput)
    ? targetInput
    : resolve(process.cwd(), targetInput);

  const force = Boolean(values.force);
  if (existsSync(targetDir) && readdirSync(targetDir).length > 0 && !force) {
    fail(
      `Target directory ${targetDir} exists and is not empty (use --force to override).`,
    );
  }

  const doInstall = !values["no-install"];
  const doGit = !values["no-git"];

  const selections: Selections = {
    slug,
    frontend,
    database,
    design,
    ci,
    cordova,
    workers,
    cache,
    rateLimit,
    websockets,
  };
  const templatesDir = findTemplatesDir();

  const s = spinner();
  s.start("Composing project");
  mkdirSync(targetDir, { recursive: true });
  compose(templatesDir, targetDir, selections);
  if (ci !== "none") {
    const releaseConfig = join(targetDir, RELEASE_CONFIG);
    writeFileSync(
      releaseConfig,
      setMaintainersOnly(readFileSync(releaseConfig, "utf8"), maintainersOnly),
    );
  }
  writeFileSync(
    join(targetDir, "docker-compose.yml"),
    renderDockerCompose(selections),
  );
  writeFileSync(join(targetDir, ".env.example"), renderEnvExample(selections));
  const readmePath = join(targetDir, "README.md");
  if (existsSync(readmePath)) injectStackBlock(readmePath, selections);
  replacePlaceholders(targetDir, buildReplacements(slug));
  const cliVersion = getCliVersion();
  finaliseRootPackage(targetDir, slug, cliVersion);
  writeManifest(targetDir, selections, cliVersion);
  const stackParts: string[] = [frontend, database, design];
  if (cordova) stackParts.push("cordova");
  if (workers) stackParts.push("workers");
  if (cache) stackParts.push("cache");
  if (rateLimit) stackParts.push("rate-limit");
  if (websockets) stackParts.push("websockets");
  if (ci !== "none") stackParts.push(ci);
  s.stop(`Composed ${pc.bold(slug)} (${stackParts.join(" + ")})`);
  log.info(
    `Packages: ${pc.bold(`@${slug}/lib`)}, ${pc.bold(`${slug}-server`)}, ${pc.bold(`${slug}-web`)}`,
  );

  if (doGit) tryGitInit(targetDir);
  if (doInstall) tryNpmInstall(targetDir);

  const rel = displayPath(targetDir);
  const steps = [
    `cd ${rel}`,
    `cp .env.example .env`,
    ...(doInstall ? [] : [`npm install`]),
    `make dev`,
  ];
  note(steps.join("\n"), "Next steps");
  outro(pc.green("Done. Happy hacking!"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
