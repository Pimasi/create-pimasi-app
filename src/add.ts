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
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  spinner,
} from "@clack/prompts";
import pc from "picocolors";
import {
  applyReplacements,
  BINARY_EXTENSIONS,
  buildReplacements,
  IGNORE_ENTRIES,
  isPlainObject,
  type JsonRecord,
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

export interface AddOptions {
  axes: ServerAxis[];
  yes: boolean;
  force: boolean;
  install: boolean;
  projectDir: string;
}

interface ApplyReport {
  written: string[];
  identical: string[];
  conflicts: string[];
  pkgAdded: string[];
  pkgKept: string[];
}

interface ApplyContext {
  projectDir: string;
  baseDir: string;
  replacements: Record<string, string>;
  report: ApplyReport;
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

const AXIS_HINTS: Record<ServerAxis, string> = {
  workers: "BullMQ queues + a workers process",
  cache: "Redis-backed $cache service",
  "rate-limit": "Redis-backed rate limiting on the auth routes",
  websockets: "realtime push over the Redis-backed $bus",
};

function fail(message: string): never {
  cancel(message);
  process.exit(1);
}

function assertCleanGitTree(projectDir: string, force: boolean): void {
  if (force) return;
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd: projectDir,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    if (out.trim().length > 0) {
      fail(
        "Working tree is not clean — commit or stash first so the add is reviewable with git diff (or pass --force).",
      );
    }
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) {
      fail(
        "Not a git repository — add mode relies on git for reviewable, revertible changes (or pass --force).",
      );
    }
    fail(
      "Could not run git — add mode relies on git for reviewable, revertible changes (or pass --force).",
    );
  }
}

function walkFragment(
  fragmentDir: string,
  relDir: string,
  ctx: ApplyContext,
): void {
  for (const entry of readdirSync(join(fragmentDir, relDir), {
    withFileTypes: true,
  })) {
    if (IGNORE_ENTRIES.has(entry.name)) continue;

    const relPath = relDir ? join(relDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      walkFragment(fragmentDir, relPath, ctx);
    } else if (entry.isFile()) {
      applyFile(fragmentDir, relPath, ctx);
    }
  }
}

function applyFile(
  fragmentDir: string,
  relPath: string,
  ctx: ApplyContext,
): void {
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
    } else {
      writeFileSync(dstPath + ".new", incoming);
      ctx.report.conflicts.push(dstRel);
    }
    return;
  }

  const incoming = applyReplacements(
    readFileSync(srcPath, "utf8"),
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

  const basePath = join(ctx.baseDir, relPath);
  if (existsSync(basePath)) {
    const pristine = applyReplacements(
      readFileSync(basePath, "utf8"),
      ctx.replacements,
    );
    if (pristine === onDisk) {
      writeFileSync(dstPath, incoming);
      ctx.report.written.push(dstRel);
      return;
    }
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
  if (onDisk === before) {
    writeFileSync(filePath, after);
    report.written.push(relPath);
    return;
  }

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
  const offAxes = SERVER_AXES.filter((axis) => !before[AXIS_KEY[axis]]);

  let axes = options.axes;
  if (axes.length === 0) {
    if (offAxes.length === 0) {
      outro("All server features are already enabled.");
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
    axes = answer as ServerAxis[];
  }

  for (const axis of axes) {
    if (before[AXIS_KEY[axis]]) {
      log.warn(`${axis} is already enabled — skipping.`);
    }
  }
  axes = axes.filter((axis) => !before[AXIS_KEY[axis]]);
  if (axes.length === 0) {
    outro("Nothing to add.");
    return;
  }

  assertCleanGitTree(options.projectDir, options.force);

  const after: Selections = { ...before };
  for (const axis of axes) after[AXIS_KEY[axis]] = true;

  const templatesDir = findTemplatesDir();
  const replacements = buildReplacements(manifest.name);
  const ctx: ApplyContext = {
    projectDir: options.projectDir,
    baseDir: join(templatesDir, "base"),
    replacements,
    report: {
      written: [],
      identical: [],
      conflicts: [],
      pkgAdded: [],
      pkgKept: [],
    },
  };

  const fragments: string[] = [];
  const redisFragBefore =
    before.workers || before.cache || before.rateLimit || before.websockets;
  const redisFragAfter =
    after.workers || after.cache || after.rateLimit || after.websockets;
  if (
    redisFragAfter &&
    (!redisFragBefore ||
      !existsSync(
        join(options.projectDir, "apps/server/src/services/redis.ts"),
      ))
  ) {
    fragments.push(join("server", "redis"));
  }
  if (after.rateLimit && !before.rateLimit) {
    fragments.push(join("server", "rate-limit"));
  }
  if (after.workers && !before.workers) {
    fragments.push(join("server", "workers"));
  }
  if (after.cache && !before.cache) {
    fragments.push(join("server", "cache"));
  }
  if (after.websockets && !before.websockets) {
    fragments.push(join("websockets", "server"));
    fragments.push(join("websockets", manifest.frontend));
  }

  const s = spinner();
  s.start(`Adding ${axes.join(" + ")}`);
  for (const fragment of fragments) {
    walkFragment(join(templatesDir, fragment), "", ctx);
  }

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

  let stackBlockForManualPaste: string | null = null;
  const readmePath = join(options.projectDir, "README.md");
  if (existsSync(readmePath)) {
    const content = readFileSync(readmePath, "utf8");
    const oldBlock = renderStackBlock(before);
    const newBlock = renderStackBlock(after);
    if (content.includes(newBlock)) {
      ctx.report.identical.push("README.md (## Stack)");
    } else if (content.includes(oldBlock)) {
      writeFileSync(readmePath, content.replace(oldBlock, newBlock));
      ctx.report.written.push("README.md (## Stack)");
    } else {
      stackBlockForManualPaste = newBlock;
      ctx.report.conflicts.push("README.md (## Stack — paste manually)");
    }
  }

  updateRootPackage(options.projectDir, cliVersion);
  writeManifest(options.projectDir, after, cliVersion);

  s.stop(`Added ${pc.bold(axes.join(" + "))}`);

  const { report } = ctx;
  if (report.written.length > 0) {
    log.success(
      `Wrote ${report.written.length} file(s):\n${report.written.map((f) => `  ${f}`).join("\n")}`,
    );
  }
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
