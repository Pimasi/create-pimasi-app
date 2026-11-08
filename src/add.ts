import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
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
import {
  format,
  type Options as PrettierOptions,
  type ParserOptions,
} from "prettier";
import { parsers } from "prettier/plugins/typescript";
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
import {
  ReleaseBranch,
  AddFeature,
  Ci,
  Frontend,
  SERVER_AXES,
  wireValues,
  type Selections,
  type ServerAxis,
} from "./types.js";

enum PackageModuleType {
  COMMONJS = "commonjs",
  MODULE = "module",
}
wireValues(PackageModuleType, ["commonjs", "module"]);

enum PackageMigrationKey {
  TYPE = "type",
  EXPORTS = "exports",
  BUILD = "scripts.build",
  TYPE_CHECK = "scripts.type-check",
  BUILD_CLEAN = "scripts.build:clean",
  BUILD_WATCH = "scripts.build:watch",
  ROLLDOWN = "dependencies.rolldown",
}

enum ReadinessValue {
  READY = "ready",
  UNAVAILABLE = "unavailable",
  OK = "ok",
  FAILED = "failed",
}

enum PrerequisiteFile {
  SERVER_PACKAGE_JSON = "apps/server/package.json",
  SHARED_PACKAGE_JSON = "apps/shared/lib/package.json",
  SERVER_CLI_ERROR_CODE_TS = "apps/server/src/cli-error-code.ts",
  SERVER_APP_SWAGGER_TS = "apps/server/src/app/swagger.ts",
  SERVER_APP_HTTP_SERVER_TS = "apps/server/src/app/http-server.ts",
  SERVER_BACKEND_TS = "apps/server/src/backend.ts",
  SERVER_CLI_TS = "apps/server/src/cli.ts",
  SERVER_TSCONFIG_JSON = "apps/server/tsconfig.json",
  SERVER_TSCONFIG_BUILD_JSON = "apps/server/tsconfig.build.json",
  SERVER_ROLLDOWN_CONFIG_TS = "apps/server/rolldown.config.ts",
  SHARED_TSCONFIG_JSON = "apps/shared/lib/tsconfig.json",
  SHARED_VALUES_WIRE_TS = "apps/shared/lib/src/values/wire.ts",
  SHARED_VALUES_HEALTH_TS = "apps/shared/lib/src/values/health.ts",
  SERVER_APP_ROUTE_VALUES_TS = "apps/server/src/app/route-values.ts",
  SERVER_MIDDLEWARE_RATE_LIMIT_KEY_TS = "apps/server/src/middleware/rate-limit-key.ts",
  SERVER_UTILS_TOKEN_TYPE_TS = "apps/server/src/utils/token-type.ts",
  SERVER_HANDLERS_AUTH_CONFIRM_PASSWORD_RESET_ROUTE_TS = "apps/server/src/handlers/auth/confirm-password-reset.route.ts",
  SERVER_HANDLERS_AUTH_LOGIN_WITH_FIREBASE_ROUTE_TS = "apps/server/src/handlers/auth/login-with-firebase.route.ts",
  _GITIGNORE = "_gitignore",
  SERVER__GITIGNORE = "apps/server/_gitignore",
  DOCKERFILE_SERVER = "Dockerfile.server",
  DOCKERFILE_WEB = "Dockerfile.web",
  SERVER_PROCESS_CONFIG_JS = "apps/server/process.config.js",
  SERVER_APP_PROCESS_CONFIG_TEST_TS = "apps/server/src/app/process-config.test.ts",
  SERVER_UTILS_ENV_TS = "apps/server/src/utils/env.ts",
  SERVER_MIDDLEWARE_RATE_LIMIT_TS = "apps/server/src/middleware/rate-limit.ts",
  SERVER_HANDLERS_PING_ROUTE_TS = "apps/server/src/handlers/ping.route.ts",
  SERVER_HANDLERS_PING_TEST_TS = "apps/server/src/handlers/ping.test.ts",
  SHARED_SCHEMAS_API_PING_RESPONSE_SCHEMA_TS = "apps/shared/lib/src/schemas/api/ping-response.schema.ts",
  SERVER_APP_READINESS_TS = "apps/server/src/app/readiness.ts",
  SERVER_APP_READINESS_TEST_TS = "apps/server/src/app/readiness.test.ts",
  SERVER_HANDLERS_READY_ROUTE_TS = "apps/server/src/handlers/ready.route.ts",
  SERVER_HANDLERS_READY_TEST_TS = "apps/server/src/handlers/ready.test.ts",
  SHARED_SCHEMAS_API_READY_RESPONSE_SCHEMA_TS = "apps/shared/lib/src/schemas/api/ready-response.schema.ts",
  SERVER_SERVICES_DATABASE_READINESS_BOOT_TS = "apps/server/src/services/database-readiness.boot.ts",
  SERVER_SERVICES_REDIS_READINESS_BOOT_TS = "apps/server/src/services/redis-readiness.boot.ts",
  SERVER_SERVICES_DATABASE_READINESS_TEST_TS = "apps/server/src/services/database-readiness.test.ts",
  SERVER_SERVICES_REDIS_READINESS_TEST_TS = "apps/server/src/services/redis-readiness.test.ts",
  WEB_TSCONFIG_JSON = "apps/web/tsconfig.json",
}

export const ADD_FEATURES = Object.values(AddFeature);

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
  keyof Pick<Selections, "workers" | "cache" | "rateLimit" | "websockets">
> = {
  [AddFeature.WORKERS]: "workers",
  [AddFeature.CACHE]: "cache",
  [AddFeature.RATE_LIMIT]: "rateLimit",
  [AddFeature.WEBSOCKETS]: "websockets",
};

const AXIS_HINTS: Record<AddFeature, string> = {
  [AddFeature.WORKERS]: "BullMQ queues + a workers process",
  [AddFeature.CACHE]: "Redis-backed $cache service",
  [AddFeature.RATE_LIMIT]: "Redis-backed rate limiting on the auth routes",
  [AddFeature.WEBSOCKETS]: "realtime push over the Redis-backed $bus",
  [AddFeature.CI_GITHUB]: "GitHub Actions CI and releases",
  [AddFeature.CI_GITLAB]: "GitLab CI and releases",
};

function isCiFeature(
  feature: AddFeature,
): feature is AddFeature.CI_GITHUB | AddFeature.CI_GITLAB {
  return feature === AddFeature.CI_GITHUB || feature === AddFeature.CI_GITLAB;
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
    if (
      onDisk === pristine ||
      normalised === (await formatPristine(pristine, relPath, ctx))
    ) {
      return true;
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
  satisfied?: (content: string) => boolean | Promise<boolean>,
): Promise<void> {
  const dstRel = join(dirname(relPath), targetName(basename(relPath)));
  const dstPath = join(ctx.projectDir, dstRel);
  if (formattingOnly && !existsSync(dstPath)) return;
  const onDisk = existsSync(dstPath) ? readFileSync(dstPath, "utf8") : null;
  if (
    !formattingOnly &&
    onDisk !== null &&
    (satisfied
      ? await satisfied(onDisk)
      : prerequisiteSatisfied(relPath, onDisk, ctx.selections.rateLimit))
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
    case PrerequisiteFile.SHARED_VALUES_WIRE_TS:
      return /export function wireValues\s*</.test(content);
    case PrerequisiteFile.SHARED_VALUES_HEALTH_TS:
      return ["PingMessage", "ReadinessStatus", "ReadinessCheckStatus"].every(
        (name) => content.includes(`export enum ${name}`),
      );
    case PrerequisiteFile.SERVER_APP_ROUTE_VALUES_TS:
      return (
        content.includes("export enum RouteMethod") &&
        content.includes("export enum ParameterLocation")
      );
    case PrerequisiteFile.SERVER_MIDDLEWARE_RATE_LIMIT_KEY_TS:
      return content.includes("export enum RateLimitKey");
    case PrerequisiteFile.SERVER_UTILS_TOKEN_TYPE_TS:
      return content.includes("export enum TokenType");
    case PrerequisiteFile.SERVER_HANDLERS_AUTH_CONFIRM_PASSWORD_RESET_ROUTE_TS:
    case PrerequisiteFile.SERVER_HANDLERS_AUTH_LOGIN_WITH_FIREBASE_ROUTE_TS:
      return content.includes("RateLimitKey.IP");
    case PrerequisiteFile._GITIGNORE:
      return ["node_modules/", "dist/", ".env"].every((line) => {
        return content.split(/\r?\n/).includes(line);
      });
    case PrerequisiteFile.SERVER__GITIGNORE:
      return content.split(/\r?\n/).includes("testy.cli.*");
    case PrerequisiteFile.DOCKERFILE_SERVER:
      return releaseArguments && /^CMD\s+\S/m.test(content);
    case PrerequisiteFile.DOCKERFILE_WEB:
      return releaseArguments && /^WORKDIR \/app\/apps\/web\s*$/m.test(content);
    case PrerequisiteFile.SERVER_PROCESS_CONFIG_JS:
      return /instances:\s*process\.env\.PM2_INSTANCES\s*\|\|\s*1/.test(
        content,
      );
    case PrerequisiteFile.SERVER_APP_PROCESS_CONFIG_TEST_TS:
      return (
        content.includes("PM2_INSTANCES") &&
        content.includes("./process.config.js") &&
        /expect\(counts\)\.toEqual\(counts\.map\(\(\) => value \|\| 1\)\)/.test(
          content,
        )
      );
    case PrerequisiteFile.SERVER_UTILS_ENV_TS:
      return (
        /^\s*APP_VERSION\s*:/m.test(content) &&
        /^\s*GIT_SHA\s*:/m.test(content) &&
        /export enum NodeEnv\s*\{/.test(content) &&
        /export enum EnvironmentBoolean\s*\{/.test(content) &&
        (!rateLimit || /^\s*RATE_LIMIT_ENABLED\s*:/m.test(content))
      );
    case PrerequisiteFile.SERVER_MIDDLEWARE_RATE_LIMIT_TS:
      return (
        content.includes("!$env.RATE_LIMIT_ENABLED") &&
        /export enum RateLimitErrorCode\s*\{/.test(content)
      );
    case PrerequisiteFile.SERVER_HANDLERS_PING_ROUTE_TS:
      return (
        /version:\s*\$env\.APP_VERSION/.test(content) &&
        /commit:\s*\$env\.GIT_SHA/.test(content) &&
        !/console\.log\(\$env\)/.test(content)
      );
    case PrerequisiteFile.SERVER_HANDLERS_PING_TEST_TS:
      return (
        /expect\(res\.data\.version\)/.test(content) &&
        /expect\(res\.data\.commit\)/.test(content)
      );
    case PrerequisiteFile.SHARED_SCHEMAS_API_PING_RESPONSE_SCHEMA_TS:
      return (
        /version:\s*Schema\.String\(\)/.test(content) &&
        /commit:\s*Schema\.String\(\)/.test(content)
      );
    case PrerequisiteFile.SERVER_APP_READINESS_TS:
      return (
        /export function registerReadinessCheck\s*\(/.test(content) &&
        /export async function runReadinessChecks\s*\(/.test(content) &&
        /Promise\.all\s*\(/.test(content) &&
        /Promise\.race\s*\(/.test(content) &&
        /\.then\(check\)/.test(content) &&
        (content.includes('"unavailable"') ||
          content.includes("ReadinessStatus.UNAVAILABLE"))
      );
    case PrerequisiteFile.SERVER_APP_READINESS_TEST_TS:
      return (
        /registerReadinessCheck\s*\(/.test(content) &&
        /runReadinessChecks\s*\(/.test(content) &&
        /advanceTimersByTimeAsync\s*\(/.test(content) &&
        (content.includes('"failed"') ||
          content.includes("ReadinessCheckStatus.FAILED"))
      );
    case PrerequisiteFile.SERVER_HANDLERS_READY_ROUTE_TS:
      return (
        /route:\s*["']\/ready["']/.test(content) &&
        /await runReadinessChecks\s*\(/.test(content) &&
        /\.status\([^)]*\?\s*200\s*:\s*503,?\s*\)/.test(content)
      );
    case PrerequisiteFile.SERVER_HANDLERS_READY_TEST_TS:
      return (
        content.includes('"/ready"') &&
        content.includes("registerReadinessCheck(") &&
        /\.status\)\.toBe\(503\)/.test(content) &&
        /\.status\)\.toBe\(200\)/.test(content)
      );
    case PrerequisiteFile.SHARED_SCHEMAS_API_READY_RESPONSE_SCHEMA_TS:
      return (
        /export const ReadyResponseSchema\s*=\s*Schema\.Object\(/.test(
          content,
        ) &&
        /checks:\s*Schema\.Record\(/.test(content) &&
        Object.entries(ReadinessValue).every(([member, value]) => {
          const enumName =
            value === ReadinessValue.READY ||
            value === ReadinessValue.UNAVAILABLE
              ? "ReadinessStatus"
              : "ReadinessCheckStatus";
          return (
            content.includes(`Schema.Const("${value}")`) ||
            content.includes(`Schema.Const('${value}')`) ||
            content.includes(`Schema.Const(${enumName}.${member})`) ||
            new RegExp(
              `Schema\\.String\\(\\{\\s*enum:\\s*Object\\.values\\(${enumName}\\)`,
            ).test(content)
          );
        })
      );
    case PrerequisiteFile.SERVER_SERVICES_DATABASE_READINESS_BOOT_TS:
      return (
        /registerReadinessCheck\(["']database["']\s*,/.test(content) &&
        (/await \$mongo\.command\(\{\s*ping:\s*1\s*\}\)/.test(content) ||
          /await sql`select 1`\.execute\(\$db\)/.test(content))
      );
    case PrerequisiteFile.SERVER_SERVICES_REDIS_READINESS_BOOT_TS:
      return (
        /registerReadinessCheck\(["']redis["']\s*,/.test(content) &&
        /await \$redis\.ping\(\)/.test(content)
      );
    case PrerequisiteFile.SERVER_SERVICES_DATABASE_READINESS_TEST_TS:
      return (
        content.includes("DatabaseReadinessBoot.handler(") &&
        content.includes("runReadinessChecks()") &&
        (content.includes('database: "failed"') ||
          /database:\s*ReadinessCheckStatus\.FAILED/.test(content))
      );
    case PrerequisiteFile.SERVER_SERVICES_REDIS_READINESS_TEST_TS:
      return (
        content.includes('"/ready"') &&
        (content.includes('database: "ok"') ||
          /database:\s*ReadinessCheckStatus\.OK/.test(content)) &&
        (content.includes('redis: "ok"') ||
          /redis:\s*ReadinessCheckStatus\.OK/.test(content))
      );
    case PrerequisiteFile.WEB_TSCONFIG_JSON:
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
  for (const relPath of [
    PrerequisiteFile._GITIGNORE,
    PrerequisiteFile.SERVER__GITIGNORE,
  ]) {
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

enum TypeScriptNodeType {
  IDENTIFIER = "Identifier",
  MEMBER_EXPRESSION = "MemberExpression",
  ASSIGNMENT_PATTERN = "AssignmentPattern",
  IMPORT_DECLARATION = "ImportDeclaration",
  IMPORT_SPECIFIER = "ImportSpecifier",
  EXPORT_NAMED_DECLARATION = "ExportNamedDeclaration",
  TS_ENUM_DECLARATION = "TSEnumDeclaration",
}

enum CommonJsName {
  DIRNAME = "__dirname",
  FILENAME = "__filename",
  REQUIRE = "require",
  MODULE = "module",
  EXPORTS = "exports",
}

enum EsmEnumName {
  CLI_ERROR_CODE = "CliErrorCode",
  SWAGGER_SECURITY_TYPE = "SwaggerSecurityType",
}

enum CliErrorCodeMember {
  DUPLICATED_COMMAND = "DUPLICATED_COMMAND",
}

enum ModuleResolution {
  BUNDLER = "bundler",
}

interface TypeScriptNode {
  type: TypeScriptNodeType;
  loc: { start: { line: number } };
  [key: string]: unknown;
}

interface TypeScriptAnalysis {
  commonJsLines: number[];
  exportedEnums: Map<string, Set<string>>;
  namedLodashImportLines: number[];
}

function isTypeScriptNode(value: unknown): value is TypeScriptNode {
  return isPlainObject(value) && typeof value.type === "string";
}

function walkTypeScript(
  node: TypeScriptNode,
  visit: (node: TypeScriptNode, binding: boolean) => void,
  binding = false,
): void {
  visit(node, binding);
  if (node.type === TypeScriptNodeType.IMPORT_DECLARATION) return;
  for (let [key, value] of Object.entries(node)) {
    if (
      [
        "comments",
        "tokens",
        "loc",
        "range",
        "label",
        "exported",
        "typeAnnotation",
        "typeArguments",
        "typeParameters",
        "returnType",
      ].includes(key)
    ) {
      continue;
    }
    if (key === "key" && node.computed !== true) continue;
    if (
      node.type === TypeScriptNodeType.MEMBER_EXPRESSION &&
      key === "property" &&
      node.computed !== true
    ) {
      continue;
    }
    let childBinding =
      key === "id" ||
      key === "params" ||
      key === "param" ||
      (binding &&
        !(
          node.type === TypeScriptNodeType.ASSIGNMENT_PATTERN && key === "right"
        ) &&
        !(key === "key" && node.computed === true)) ||
      (node.type.startsWith("TS") &&
        !["expression", "initializer", "body", "members"].includes(key));
    for (let child of Array.isArray(value) ? value : [value]) {
      if (isTypeScriptNode(child)) {
        walkTypeScript(child, visit, childBinding);
      }
    }
  }
}

async function analyseTypeScript(
  content: string,
): Promise<TypeScriptAnalysis | null> {
  let ast: TypeScriptNode;
  try {
    ast = await parsers.typescript.parse(content, {} as ParserOptions);
  } catch {
    return null;
  }
  let lines = new Set<number>();
  let exportedEnums = new Map<string, Set<string>>();
  let namedLodashImportLines: number[] = [];
  let named = (value: unknown, name: CommonJsName): boolean => {
    return (
      isTypeScriptNode(value) &&
      value.type === TypeScriptNodeType.IDENTIFIER &&
      value.name === name
    );
  };
  walkTypeScript(ast, (node, binding) => {
    if (
      !binding &&
      node.type === TypeScriptNodeType.IDENTIFIER &&
      [CommonJsName.DIRNAME, CommonJsName.FILENAME, CommonJsName.REQUIRE].some(
        (name) => node.name === name,
      )
    ) {
      lines.add(node.loc.start.line);
    }
    if (
      node.type === TypeScriptNodeType.MEMBER_EXPRESSION &&
      ((named(node.object, CommonJsName.MODULE) &&
        node.computed !== true &&
        named(node.property, CommonJsName.EXPORTS)) ||
        named(node.object, CommonJsName.EXPORTS))
    ) {
      lines.add(node.loc.start.line);
    }
    if (
      node.type === TypeScriptNodeType.EXPORT_NAMED_DECLARATION &&
      isTypeScriptNode(node.declaration) &&
      node.declaration.type === TypeScriptNodeType.TS_ENUM_DECLARATION &&
      isTypeScriptNode(node.declaration.id) &&
      typeof node.declaration.id.name === "string" &&
      isTypeScriptNode(node.declaration.body) &&
      Array.isArray(node.declaration.body.members)
    ) {
      let members = new Set<string>();
      for (let member of node.declaration.body.members) {
        if (!isTypeScriptNode(member) || !isTypeScriptNode(member.id)) continue;
        let name = member.id.name ?? member.id.value;
        if (typeof name === "string") members.add(name);
      }
      exportedEnums.set(node.declaration.id.name, members);
    }
    if (
      node.type === TypeScriptNodeType.IMPORT_DECLARATION &&
      isTypeScriptNode(node.source) &&
      node.source.value === "lodash" &&
      Array.isArray(node.specifiers) &&
      node.specifiers.some(
        (specifier) =>
          isTypeScriptNode(specifier) &&
          specifier.type === TypeScriptNodeType.IMPORT_SPECIFIER,
      )
    ) {
      namedLodashImportLines.push(node.loc.start.line);
    }
  });
  return {
    commonJsLines: [...lines].sort((left, right) => left - right),
    exportedEnums,
    namedLodashImportLines,
  };
}

function parseJsonc(content: string): JsonRecord | null {
  try {
    let stripped = content.replace(
      /"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
      (token) => (token.startsWith('"') ? token : " "),
    );
    stripped = stripped.replace(/"(?:\\.|[^"\\])*"|,\s*(?=[}\]])/g, (token) =>
      token.startsWith('"') ? token : "",
    );
    let parsed: unknown = JSON.parse(stripped);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function commonJsReview(ctx: ApplyContext): Promise<string[]> {
  let written = new Set([
    ...ctx.report.written,
    ...ctx.report.upgraded.map((entry) => entry.split(": ")[0]),
  ]);
  let hits: string[] = [];
  let inspect = async (relPath: string): Promise<void> => {
    if (written.has(relPath)) return;
    let content = readFileSync(join(ctx.projectDir, relPath), "utf8");
    let analysis = await analyseTypeScript(content);
    if (analysis === null) hits.push(`${relPath}: parse failure`);
    else {
      for (let line of analysis.commonJsLines) hits.push(`${relPath}:${line}`);
      for (let line of analysis.namedLodashImportLines) {
        hits.push(
          `${relPath}:${line}: ES modules need the default import (import lodash from "lodash")`,
        );
      }
    }
  };
  let walk = async (relDir: string): Promise<void> => {
    if (!existsSync(join(ctx.projectDir, relDir))) return;
    for (let entry of readdirSync(join(ctx.projectDir, relDir), {
      withFileTypes: true,
    })) {
      let relPath = join(relDir, entry.name);
      if (entry.isDirectory()) await walk(relPath);
      else if (entry.isFile() && entry.name.endsWith(".ts"))
        await inspect(relPath);
    }
  };
  await walk("apps/server/src");
  await walk("apps/shared/lib/src");
  for (let entry of readdirSync(join(ctx.projectDir, "apps/server"), {
    withFileTypes: true,
  })) {
    if (entry.isFile() && entry.name.endsWith(".js")) {
      await inspect(join("apps/server", entry.name));
    }
  }
  return hits;
}

function migratePackageKeys(
  relPath: PrerequisiteFile,
  keys: PackageMigrationKey[],
  ctx: ApplyContext,
): void {
  let template = JSON.parse(
    applyReplacements(
      readFileSync(join(ctx.templatesDir, "base", relPath), "utf8"),
      ctx.replacements,
    ),
  ) as JsonRecord;
  let path = join(ctx.projectDir, relPath);
  let target = JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
  let published: JsonRecord[] = [];
  let legacyDir = join(ctx.templatesDir, "legacy");
  for (let entry of readdirSync(legacyDir, { withFileTypes: true })) {
    let snapshot = join(legacyDir, entry.name, "base", relPath);
    if (!entry.isDirectory() || !existsSync(snapshot)) continue;
    published.push(
      JSON.parse(
        applyReplacements(readFileSync(snapshot, "utf8"), ctx.replacements),
      ) as JsonRecord,
    );
  }
  let valueAt = (pkg: JsonRecord, parts: string[]): unknown => {
    let value: unknown = pkg;
    for (let part of parts) {
      if (!isPlainObject(value)) return undefined;
      value = value[part];
    }
    return value;
  };
  let changed = false;
  for (let key of keys) {
    let parts = key.split(".");
    let current = valueAt(target, parts);
    let incoming = valueAt(template, parts);
    if (isDeepStrictEqual(current, incoming)) continue;
    if (
      !published.some((pkg) => isDeepStrictEqual(valueAt(pkg, parts), current))
    ) {
      ctx.report.mergeBeforeRelease.push(
        `${relPath}: ${key} kept as ${JSON.stringify(current) ?? "absent"} (expected ${JSON.stringify(incoming) ?? "absent"})`,
      );
      continue;
    }
    let parent = target;
    for (let part of parts.slice(0, -1)) {
      if (!isPlainObject(parent[part])) parent[part] = {};
      parent = parent[part] as JsonRecord;
    }
    let last = parts.at(-1)!;
    if (incoming === undefined) delete parent[last];
    else if (key === PackageMigrationKey.TYPE && current === undefined) {
      let templateKeys = Object.keys(template);
      let preceding = templateKeys
        .slice(0, templateKeys.indexOf(key))
        .reverse();
      let anchor = preceding.find((name) => Object.hasOwn(target, name));
      let ordered: JsonRecord = {};
      if (anchor === undefined) ordered[key] = incoming;
      for (let [name, value] of Object.entries(target)) {
        ordered[name] = value;
        if (name === anchor) ordered[key] = incoming;
      }
      target = ordered;
    } else parent[last] = incoming;
    changed = true;
    ctx.report.upgraded.push(`${relPath}: ${key}`);
  }
  if (changed) writeFileSync(path, JSON.stringify(target, null, 4) + "\n");
}

async function upgradeEsmPrerequisites(ctx: ApplyContext): Promise<void> {
  let prerequisites: [
    string,
    PrerequisiteFile,
    ((content: string) => boolean | Promise<boolean>)?,
  ][] = [
    ["base", PrerequisiteFile.SHARED_VALUES_WIRE_TS],
    [`db/${ctx.selections.database}`, PrerequisiteFile.SERVER_UTILS_ENV_TS],
    [
      "base",
      PrerequisiteFile.SERVER_CLI_ERROR_CODE_TS,
      async (content) => {
        let analysis = await analyseTypeScript(content);
        return (
          analysis?.exportedEnums
            .get(EsmEnumName.CLI_ERROR_CODE)
            ?.has(CliErrorCodeMember.DUPLICATED_COMMAND) === true
        );
      },
    ],
    [
      "base",
      PrerequisiteFile.SERVER_APP_SWAGGER_TS,
      async (content) => {
        let analysis = await analyseTypeScript(content);
        return (
          analysis?.exportedEnums.has(EsmEnumName.SWAGGER_SECURITY_TYPE) ===
            true && analysis.namedLodashImportLines.length === 0
        );
      },
    ],
    ...[
      PrerequisiteFile.SERVER_APP_HTTP_SERVER_TS,
      PrerequisiteFile.SERVER_BACKEND_TS,
      PrerequisiteFile.SERVER_CLI_TS,
    ].map(
      (
        path,
      ): [string, PrerequisiteFile, (content: string) => Promise<boolean>] => [
        "base",
        path,
        async (content) => {
          let analysis = await analyseTypeScript(content);
          return analysis !== null && analysis.commonJsLines.length === 0;
        },
      ],
    ),
    [
      "base",
      PrerequisiteFile.SERVER_TSCONFIG_JSON,
      (content) => {
        let config = parseJsonc(content);
        let options = config?.compilerOptions;
        return (
          isPlainObject(options) &&
          typeof options.moduleResolution === "string" &&
          options.moduleResolution.toLowerCase() === ModuleResolution.BUNDLER &&
          options.noEmit === true
        );
      },
    ],
    [
      "base",
      PrerequisiteFile.SERVER_TSCONFIG_BUILD_JSON,
      (content) => {
        let config = parseJsonc(content);
        return config !== null && !Object.hasOwn(config, "references");
      },
    ],
    ["base", PrerequisiteFile.SERVER_ROLLDOWN_CONFIG_TS, () => true],
    [
      "base",
      PrerequisiteFile.SHARED_TSCONFIG_JSON,
      (content) => {
        let config = parseJsonc(content);
        let options = config?.compilerOptions;
        return (
          isPlainObject(options) &&
          typeof options.moduleResolution === "string" &&
          options.moduleResolution.toLowerCase() === ModuleResolution.BUNDLER &&
          (!Object.hasOwn(options, "composite") || options.composite === false)
        );
      },
    ],
  ];
  for (let [fragment, relPath, satisfied] of prerequisites) {
    await upgradePrerequisite(
      fragment,
      relPath,
      "support the ES module server build",
      ctx,
      false,
      satisfied,
    );
  }
  migratePackageKeys(
    PrerequisiteFile.SERVER_PACKAGE_JSON,
    [
      PackageMigrationKey.TYPE,
      PackageMigrationKey.BUILD,
      PackageMigrationKey.TYPE_CHECK,
      PackageMigrationKey.BUILD_CLEAN,
      PackageMigrationKey.BUILD_WATCH,
      PackageMigrationKey.ROLLDOWN,
    ],
    ctx,
  );
  migratePackageKeys(
    PrerequisiteFile.SHARED_PACKAGE_JSON,
    [
      PackageMigrationKey.TYPE,
      PackageMigrationKey.EXPORTS,
      PackageMigrationKey.BUILD,
      PackageMigrationKey.BUILD_WATCH,
      PackageMigrationKey.TYPE_CHECK,
    ],
    ctx,
  );
}

async function upgradeReleasePrerequisites(
  selections: Selections,
  ctx: ApplyContext,
): Promise<void> {
  const prerequisites: [string, string, string][] = [
    [
      "base",
      PrerequisiteFile.SHARED_VALUES_WIRE_TS,
      "provide compile-time wire-value pins",
    ],
    [
      "base",
      PrerequisiteFile.SHARED_VALUES_HEALTH_TS,
      "provide the health response values",
    ],
    [
      "base",
      PrerequisiteFile.SERVER_APP_ROUTE_VALUES_TS,
      "provide the route method values",
    ],
    [
      "base",
      PrerequisiteFile._GITIGNORE,
      "ignore local secrets, dependencies and generated build artefacts",
    ],
    [
      "base",
      PrerequisiteFile.SERVER__GITIGNORE,
      "ignore generated local server commands",
    ],
    [
      "base",
      PrerequisiteFile.DOCKERFILE_SERVER,
      "start the production server and embed version and commit",
    ],
    [
      selections.workers ? "server/workers" : "base",
      PrerequisiteFile.SERVER_PROCESS_CONFIG_JS,
      "default each PM2 process to one instance",
    ],
    [
      "base",
      PrerequisiteFile.SERVER_APP_PROCESS_CONFIG_TEST_TS,
      "assert the PM2 instance default",
    ],
    [
      "base",
      PrerequisiteFile.SERVER_HANDLERS_PING_ROUTE_TS,
      "report version and commit without logging the environment",
    ],
    [
      "base",
      PrerequisiteFile.SERVER_HANDLERS_PING_TEST_TS,
      "assert the release health response",
    ],
    [
      "base",
      PrerequisiteFile.SHARED_SCHEMAS_API_PING_RESPONSE_SCHEMA_TS,
      "type the release health metadata",
    ],
    [
      `db/${selections.database}`,
      PrerequisiteFile.SERVER_UTILS_ENV_TS,
      "read the release version and commit",
    ],
    [
      `frontend/${selections.frontend}`,
      PrerequisiteFile.DOCKERFILE_WEB,
      "build the web image with release labels and the correct working directory",
    ],
  ];
  if (selections.frontend === Frontend.NEXTJS) {
    prerequisites.push([
      "frontend/nextjs",
      PrerequisiteFile.WEB_TSCONFIG_JSON,
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
      ? [PrerequisiteFile.SERVER_MIDDLEWARE_RATE_LIMIT_TS]
      : []),
    "apps/server/src/test/db-helpers.ts",
    ...(selections.frontend === Frontend.TANSTACK
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
  let limiterPath = join(
    ctx.projectDir,
    PrerequisiteFile.SERVER_MIDDLEWARE_RATE_LIMIT_TS,
  );
  let upgradeLimiter =
    !existsSync(limiterPath) ||
    !prerequisiteSatisfied(
      PrerequisiteFile.SERVER_MIDDLEWARE_RATE_LIMIT_TS,
      readFileSync(limiterPath, "utf8"),
      true,
    );
  for (const [fragment, relPath] of [
    ["base", PrerequisiteFile.SHARED_VALUES_WIRE_TS],
    ["base", PrerequisiteFile.SERVER_MIDDLEWARE_RATE_LIMIT_KEY_TS],
    ["base", PrerequisiteFile.SERVER_APP_ROUTE_VALUES_TS],
    [`db/${selections.database}`, PrerequisiteFile.SERVER_UTILS_ENV_TS],
    ["base", "apps/server/src/utils/env.test.ts"],
    ["server/rate-limit", PrerequisiteFile.SERVER_MIDDLEWARE_RATE_LIMIT_TS],
    ["server/rate-limit", "apps/server/src/middleware/rate-limit.test.ts"],
  ]) {
    await upgradePrerequisite(
      fragment,
      relPath,
      "allow and test disabling rate limiting for the CI gate",
      { ...ctx, selections },
    );
  }
  if (upgradeLimiter) {
    for (let relPath of [
      PrerequisiteFile.SERVER_HANDLERS_AUTH_CONFIRM_PASSWORD_RESET_ROUTE_TS,
      PrerequisiteFile.SERVER_HANDLERS_AUTH_LOGIN_WITH_FIREBASE_ROUTE_TS,
    ]) {
      if (!existsSync(join(ctx.projectDir, relPath))) continue;
      await upgradePrerequisite(
        "base",
        relPath,
        "use enum keys with the upgraded rate limiter",
        ctx,
      );
    }
  }
}

async function upgradeReadinessPrerequisites(
  selections: Selections,
  ctx: ApplyContext,
): Promise<void> {
  const prerequisites: [string, string, string][] = [
    ...[
      PrerequisiteFile.SHARED_VALUES_WIRE_TS,
      PrerequisiteFile.SHARED_VALUES_HEALTH_TS,
      PrerequisiteFile.SERVER_APP_ROUTE_VALUES_TS,
      PrerequisiteFile.SERVER_APP_READINESS_TS,
      PrerequisiteFile.SERVER_APP_READINESS_TEST_TS,
      PrerequisiteFile.SERVER_HANDLERS_READY_ROUTE_TS,
      PrerequisiteFile.SERVER_HANDLERS_READY_TEST_TS,
      PrerequisiteFile.SHARED_SCHEMAS_API_READY_RESPONSE_SCHEMA_TS,
    ].map((path): [string, string, string] => [
      "base",
      path,
      "provide the readiness registry, endpoint and checks",
    ]),
    [
      `db/${selections.database}`,
      PrerequisiteFile.SERVER_SERVICES_DATABASE_READINESS_BOOT_TS,
      "register the database readiness check",
    ],
    [
      `db/${selections.database}`,
      PrerequisiteFile.SERVER_SERVICES_DATABASE_READINESS_TEST_TS,
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
      PrerequisiteFile.SERVER_SERVICES_REDIS_READINESS_BOOT_TS,
      PrerequisiteFile.SERVER_SERVICES_REDIS_READINESS_TEST_TS,
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
  if (branch !== ReleaseBranch.MAIN) {
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
  if (before.ci === Ci.NONE)
    offAxes.push(AddFeature.CI_GITHUB, AddFeature.CI_GITLAB);

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
  const ciHost = ciFeature === AddFeature.CI_GITHUB ? Ci.GITHUB : Ci.GITLAB;
  if (options.refresh) {
    if (!ciFeature || axes.length !== 1 || before.ci !== ciHost) {
      fail(
        "Refresh requires only ci-<host> matching the project's current CI host.",
      );
    }
  } else if (ciFeature && before.ci !== Ci.NONE) {
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
  let serverPackagePath = join(
    options.projectDir,
    PrerequisiteFile.SERVER_PACKAGE_JSON,
  );
  let migrating =
    fragments.includes("server/workers") &&
    existsSync(serverPackagePath) &&
    JSON.parse(readFileSync(serverPackagePath, "utf8")).type !==
      PackageModuleType.MODULE;
  if (migrating) await upgradeEsmPrerequisites(ctx);
  if (ciFeature) {
    if (!options.refresh) await upgradeReleasePrerequisites(after, ctx);
  } else if (fragments.includes("server/redis")) {
    await upgradeReadinessPrerequisites(after, ctx);
  }
  if (ciFeature || fragments.includes("server/rate-limit")) {
    await upgradeRateLimitPrerequisites(after, ctx);
  }
  if (fragments.includes("websockets/server")) {
    for (let path of [
      PrerequisiteFile.SHARED_VALUES_WIRE_TS,
      PrerequisiteFile.SERVER_UTILS_TOKEN_TYPE_TS,
    ]) {
      await upgradePrerequisite(
        "base",
        path,
        "provide the websocket authentication token values and wire-value pins",
        ctx,
      );
    }
  }
  for (const fragment of fragments) {
    await walkFragment(join(templatesDir, fragment), "", ctx);
  }
  let commonJsHits = migrating ? await commonJsReview(ctx) : [];

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
      `Upgraded ${ciFeature && !migrating ? "release " : ""}prerequisites:\n${report.upgraded.map((f) => `  ${f}`).join("\n")}`,
    );
  }
  if (report.mergeBeforeRelease.length > 0) {
    note(
      report.mergeBeforeRelease.join("\n"),
      ciFeature && !migrating
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
  if (commonJsHits.length > 0) {
    log.warn(
      `CommonJS review: ES modules use import.meta.dirname, import.meta.filename, await import() and export. Review these files before building:\n${commonJsHits.map((hit) => `  ${hit}`).join("\n")}`,
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
    ...(migrating ? ["npm run type-check"] : []),
    "make dev",
    ...(axes.includes(AddFeature.WEBSOCKETS)
      ? ["mount <WebSocketProvider> in the app shell (see README)"]
      : []),
  ];
  note(steps.join("\n"), "Next steps");
  outro(pc.green("Done."));
}
