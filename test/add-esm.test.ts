import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import {
  applyReplacements,
  buildReplacements,
  deepMerge,
  type JsonRecord,
} from "../src/compose.js";
import { AddFeature, Ci, Command, Database, wireValues } from "../src/types.js";

enum PublishedRelease {
  V020 = "0.2.0",
  V030 = "0.3.0",
  V031 = "0.3.1",
}
wireValues(PublishedRelease, ["0.2.0", "0.3.0", "0.3.1"]);

enum PackageModuleType {
  COMMONJS = "commonjs",
  MODULE = "module",
}
wireValues(PackageModuleType, ["commonjs", "module"]);

enum PackageKey {
  TYPE = "type",
  EXPORTS = "exports",
  BUILD = "scripts.build",
  TYPE_CHECK = "scripts.type-check",
  BUILD_CLEAN = "scripts.build:clean",
  BUILD_WATCH = "scripts.build:watch",
  ROLLDOWN = "dependencies.rolldown",
}

enum ProseWrap {
  ALWAYS = "always",
}

enum ModuleResolution {
  BUNDLER = "bundler",
}

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CLI = join(ROOT, "dist/index.js");
const SNAPSHOTS = join(ROOT, "templates/legacy");
const NAME = "published-esm";
const SERVER_PACKAGE = "apps/server/package.json";
const LIB_PACKAGE = "apps/shared/lib/package.json";
const BACKEND = "apps/server/src/backend.ts";
const FILE_PREREQUISITES = [
  "apps/shared/lib/src/values/wire.ts",
  "apps/server/src/cli-error-code.ts",
  "apps/server/src/app/swagger.ts",
  "apps/server/src/app/http-server.ts",
  BACKEND,
  "apps/server/src/cli.ts",
  "apps/server/tsconfig.json",
  "apps/server/tsconfig.build.json",
  "apps/server/rolldown.config.ts",
  "apps/shared/lib/tsconfig.json",
];
const SERVER_KEYS = [
  PackageKey.TYPE,
  PackageKey.BUILD,
  PackageKey.TYPE_CHECK,
  PackageKey.BUILD_CLEAN,
  PackageKey.BUILD_WATCH,
  PackageKey.ROLLDOWN,
];
const LIB_KEYS = [
  PackageKey.TYPE,
  PackageKey.EXPORTS,
  PackageKey.BUILD,
  PackageKey.BUILD_WATCH,
  PackageKey.TYPE_CHECK,
];

function command(dir: string, executable: string, args: string[]) {
  let result = spawnSync(executable, args, {
    cwd: dir,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git") return [];
    return entry.isDirectory()
      ? files(join(dir, entry.name)).map((path) => join(entry.name, path))
      : [entry.name];
  });
}

function rendered(fragment: string, path: string) {
  return applyReplacements(
    readFileSync(join(ROOT, "templates", fragment, path), "utf8"),
    buildReplacements(NAME),
  );
}

function readPackage(dir: string, path: string): JsonRecord {
  return JSON.parse(readFileSync(join(dir, path), "utf8"));
}

function writePackage(dir: string, path: string, content: JsonRecord) {
  writeFileSync(join(dir, path), JSON.stringify(content, null, 4) + "\n");
}

function keyValue(content: JsonRecord, key: PackageKey): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    return value && typeof value === "object"
      ? (value as JsonRecord)[part]
      : undefined;
  }, content);
}

function record(dir: string) {
  for (let args of [
    [Command.ADD, "."],
    [
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-qm",
      "test: record published CommonJS project",
    ],
  ]) {
    let result = command(dir, "git", args);
    assert.equal(result.status, 0, result.output);
  }
}

function scaffold(t: TestContext) {
  let dir = mkdtempSync(join(tmpdir(), "published-esm-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fixture(
  t: TestContext,
  release?: PublishedRelease,
  database = Database.MONGO,
) {
  let dir = scaffold(t);
  let generated = command(dir, process.execPath, [
    CLI,
    NAME,
    "--yes",
    "--db",
    database,
    "--ci",
    Ci.NONE,
    "--no-workers",
    "--no-cache",
    "--no-rate-limit",
    "--no-websockets",
    "--no-install",
    "--dir",
    dir,
  ]);
  assert.equal(generated.status, 0, generated.output);
  if (release === undefined) return dir;
  let releases = Object.values(PublishedRelease);
  let candidates = [
    ...releases.slice(releases.indexOf(release)),
    ...releases.slice(0, releases.indexOf(release)).reverse(),
  ];
  for (let fragment of ["base", `db/${database}`]) {
    let paths = new Set(
      releases.flatMap((version) => files(join(SNAPSHOTS, version, fragment))),
    );
    for (let path of paths) {
      if (path === "README.md") continue;
      let version = candidates.find((candidate) =>
        existsSync(join(SNAPSHOTS, candidate, fragment, path)),
      );
      assert.ok(version, path);
      let content = rendered(`legacy/${version}/${fragment}`, path);
      if (path === SERVER_PACKAGE) {
        content =
          JSON.stringify(
            deepMerge(
              JSON.parse(content),
              JSON.parse(rendered(`db/${database}`, SERVER_PACKAGE)),
            ),
            null,
            4,
          ) + "\n";
      }
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
  }
  for (let path of [
    "apps/server/rolldown.config.ts",
    "apps/shared/lib/src/values/wire.ts",
    "apps/shared/lib/src/values/health.ts",
    "apps/server/src/app/route-values.ts",
    "apps/server/src/middleware/rate-limit-key.ts",
    "apps/server/src/utils/token-type.ts",
    ...(release === PublishedRelease.V031
      ? []
      : ["apps/server/src/cli-error-code.ts"]),
  ]) {
    rmSync(join(dir, path), { force: true });
  }
  let manifest = readPackage(dir, "pimasi.json");
  manifest.cliVersion = release;
  writePackage(dir, "pimasi.json", manifest);
  return dir;
}

function add(
  dir: string,
  feature = AddFeature.WORKERS,
  features: AddFeature[] = [],
) {
  let result = command(dir, process.execPath, [
    CLI,
    Command.ADD,
    feature,
    ...features,
    "--yes",
    "--no-install",
  ]);
  assert.equal(result.status, 0, result.output);
  return result.output;
}

function assertPackageKeys(dir: string) {
  for (let [path, keys] of [
    [SERVER_PACKAGE, SERVER_KEYS],
    [LIB_PACKAGE, LIB_KEYS],
  ] as const) {
    let actual = readPackage(dir, path);
    let expected = JSON.parse(rendered("base", path));
    for (let key of keys) {
      assert.deepEqual(
        keyValue(actual, key),
        keyValue(expected, key),
        `${path}: ${key}`,
      );
    }
    assert.equal(actual.type, PackageModuleType.MODULE, path);
    assert.equal(
      readFileSync(join(dir, path), "utf8"),
      JSON.stringify(actual, null, 4) + "\n",
      path,
    );
  }
}

test("0.2.0: CI adoption keeps the CommonJS build clean without migrating", (t) => {
  let dir = fixture(t, PublishedRelease.V020);
  let paths = [
    SERVER_PACKAGE,
    LIB_PACKAGE,
    "apps/server/tsconfig.json",
    "apps/server/tsconfig.build.json",
    "apps/shared/lib/tsconfig.json",
  ];
  let originals = new Map(
    paths.map((path) => [path, readFileSync(join(dir, path), "utf8")]),
  );
  writeFileSync(
    join(dir, "apps/server/src/project-commonjs.ts"),
    "let directory = __dirname;\n",
  );
  record(dir);
  let output = add(dir, AddFeature.CI_GITHUB);
  assert.match(
    readFileSync(join(dir, "Dockerfile.server"), "utf8"),
    /^RUN npm run build:clean$/m,
  );
  assert.equal(readPackage(dir, SERVER_PACKAGE).type, undefined);
  assert.equal(
    keyValue(readPackage(dir, SERVER_PACKAGE), PackageKey.BUILD_CLEAN),
    "tsc -b tsconfig.build.json --clean && npm run build",
  );
  for (let [path, content] of originals) {
    assert.equal(readFileSync(join(dir, path), "utf8"), content, path);
    assert.equal(existsSync(join(dir, path + ".new")), false, path);
  }
  assert.equal(existsSync(join(dir, "apps/server/rolldown.config.ts")), false);
  assert.equal(existsSync(join(dir, ".github/workflows/ci.yml")), true);
  assert.equal(readPackage(dir, "pimasi.json").ci, Ci.GITHUB);
  assert.doesNotMatch(output, /CommonJS review/);
});

test("0.3.1: migration gives the ES module server a clean build and preserves the Dockerfile", (t) => {
  let dir = fixture(t, PublishedRelease.V031);
  let dockerfile = readFileSync(join(dir, "Dockerfile.server"), "utf8");
  record(dir);
  let output = add(dir);
  assert.equal(
    keyValue(readPackage(dir, SERVER_PACKAGE), PackageKey.BUILD_CLEAN),
    "rm -rf dist && npm run build",
  );
  assert.equal(
    keyValue(
      JSON.parse(rendered("base", SERVER_PACKAGE)),
      PackageKey.BUILD_CLEAN,
    ),
    "rm -rf dist && npm run build",
  );
  assert.equal(
    readFileSync(join(dir, "Dockerfile.server"), "utf8"),
    dockerfile,
  );
  assert.doesNotMatch(output, /Dockerfile\.server/);
});

test("0.3.1: CI adoption reformats a published README in place with project Prettier settings", async (t) => {
  let dir = fixture(t, PublishedRelease.V031);
  let prefix = readFileSync(join(dir, "README.md"), "utf8").split(
    "A full-stack",
  )[0];
  let published = rendered("legacy/0.3.0/base", "README.md").replaceAll(
    "UserRoles",
    "UserRole",
  );
  let content = prefix + published.slice(published.indexOf("A full-stack"));
  let options = {
    filepath: "README.md",
    tabWidth: 4,
    proseWrap: ProseWrap.ALWAYS,
  };
  content = await format(content, { ...options, printWidth: 100 });
  writeFileSync(join(dir, "README.md"), content);
  writePackage(dir, ".prettierrc", {
    tabWidth: 4,
    proseWrap: ProseWrap.ALWAYS,
    printWidth: 80,
  });
  record(dir);
  let output = add(dir, AddFeature.CI_GITHUB);
  assert.equal(
    existsSync(join(dir, "README.md.new")),
    false,
    "Published 0.3.1 README should be reformatted in place",
  );
  let expected = await format(content, { ...options, printWidth: 80 });
  expected = expected.replace(
    "- **Mobile**: not enabled",
    "- **Mobile**: not enabled\n- **CI and releases**: GitHub",
  );
  assert.equal(readFileSync(join(dir, "README.md"), "utf8"), expected);
  assert.doesNotMatch(output, /README\.md\.new/);
});

test("workers and CI together report migration upgrades and conflicts under build titles", (t) => {
  let dir = fixture(t, PublishedRelease.V031);
  let server = readPackage(dir, SERVER_PACKAGE);
  (server.scripts as JsonRecord).build = "project-build";
  writePackage(dir, SERVER_PACKAGE, server);
  record(dir);
  let output = add(dir, AddFeature.WORKERS, [AddFeature.CI_GITHUB]);
  assert.equal(readPackage(dir, SERVER_PACKAGE).type, PackageModuleType.MODULE);
  assert.equal(readPackage(dir, LIB_PACKAGE).type, PackageModuleType.MODULE);
  assert.equal(
    keyValue(readPackage(dir, SERVER_PACKAGE), PackageKey.BUILD),
    "project-build",
  );
  assert.equal(existsSync(join(dir, "apps/server/src/workers.ts")), true);
  assert.equal(existsSync(join(dir, ".github/workflows/ci.yml")), true);
  assert.equal(readPackage(dir, "pimasi.json").ci, Ci.GITHUB);
  assert.equal(readPackage(dir, "pimasi.json").workers, true);
  let upgraded = output.indexOf("Upgraded prerequisites:");
  let merge = output.indexOf("Merge before building");
  let next = output.indexOf("Next steps");
  assert.ok(upgraded >= 0, "Expected Upgraded prerequisites title");
  assert.ok(merge > upgraded, "Expected Merge before building after upgrades");
  assert.ok(next > merge, "Expected Next steps after merge entries");
  assert.ok(
    output.slice(upgraded, merge).includes(`${SERVER_PACKAGE}: type`),
    output,
  );
  assert.ok(
    output.slice(upgraded, merge).includes(`${LIB_PACKAGE}: exports`),
    output,
  );
  assert.ok(
    output
      .slice(merge, next)
      .includes(`${SERVER_PACKAGE}: scripts.build kept as`),
    output,
  );
  assert.doesNotMatch(
    output,
    /Upgraded release prerequisites|Merge before your first gate run or release/,
  );
});

for (let [release, database] of [
  [PublishedRelease.V020, Database.MONGO],
  [PublishedRelease.V030, Database.MONGO],
  [PublishedRelease.V031, Database.MONGO],
  [PublishedRelease.V031, Database.POSTGRES],
] as const) {
  test(`${release} ${database}: adding workers migrates published CommonJS files and package keys`, (t) => {
    let dir = fixture(t, release, database);
    assert.equal(readPackage(dir, SERVER_PACKAGE).type, undefined);
    record(dir);
    let output = add(dir);
    assert.deepEqual(
      files(dir).filter((path) => path.endsWith(".new")),
      [],
      output,
    );
    for (let path of FILE_PREREQUISITES) {
      assert.equal(
        readFileSync(join(dir, path), "utf8"),
        rendered("base", path),
        path,
      );
    }
    let env = "apps/server/src/utils/env.ts";
    assert.equal(
      readFileSync(join(dir, env), "utf8"),
      rendered(`db/${database}`, env),
    );
    assertPackageKeys(dir);
    let processConfig = "apps/server/process.config.js";
    assert.equal(
      readFileSync(join(dir, processConfig), "utf8"),
      rendered("server/workers", processConfig),
    );
    for (let [path, previous] of [
      [SERVER_PACKAGE, "license"],
      [LIB_PACKAGE, "private"],
    ]) {
      let keys = Object.keys(readPackage(dir, path));
      assert.equal(keys[keys.indexOf(previous) + 1], PackageKey.TYPE, path);
    }
    assert.match(output, /Upgraded prerequisites/);
    assert.ok(output.includes(`${SERVER_PACKAGE}: type`), output);
    assert.ok(output.includes(`${LIB_PACKAGE}: exports`), output);
    assert.match(output, /npm run type-check/);
    assert.doesNotMatch(output, /Merge before building/);
  });
}

test("edited CommonJS backend is preserved with the migrated render beside it", (t) => {
  let dir = fixture(t, PublishedRelease.V031);
  let content =
    readFileSync(join(dir, BACKEND), "utf8") +
    '\nexport const PROJECT_LABEL = "custom";\n';
  writeFileSync(join(dir, BACKEND), content);
  record(dir);
  let output = add(dir);
  assert.equal(readFileSync(join(dir, BACKEND), "utf8"), content);
  assert.equal(
    readFileSync(join(dir, BACKEND + ".new"), "utf8"),
    rendered("base", BACKEND),
  );
  assert.match(output, /Merge before building/);
  assert.ok(output.includes(`${BACKEND}.new:`), output);
  for (let path of FILE_PREREQUISITES.filter((path) => path !== BACKEND)) {
    assert.equal(
      readFileSync(join(dir, path), "utf8"),
      rendered("base", path),
      path,
    );
  }
  assertPackageKeys(dir);
});

test("custom package build survives while published keys migrate without changing other key order", (t) => {
  let dir = fixture(t, PublishedRelease.V031);
  let server = readPackage(dir, SERVER_PACKAGE);
  let scripts = server.scripts as JsonRecord;
  let dependencies = server.dependencies as JsonRecord;
  scripts.build = "project-build";
  dependencies.express = "^99.0.0";
  server.project = { enabled: true };
  let oldKeys = Object.keys(server);
  let scriptKeys = Object.keys(scripts);
  writePackage(dir, SERVER_PACKAGE, server);
  record(dir);
  let output = add(dir);
  let migrated = readPackage(dir, SERVER_PACKAGE);
  assert.equal(keyValue(migrated, PackageKey.BUILD), "project-build");
  assert.equal((migrated.dependencies as JsonRecord).express, "^99.0.0");
  assert.deepEqual(migrated.project, { enabled: true });
  assert.deepEqual(
    Object.keys(migrated).filter((key) => key !== PackageKey.TYPE),
    oldKeys,
  );
  assert.deepEqual(
    Object.keys(migrated.scripts as JsonRecord).filter(
      (key) => key !== "dev:workers",
    ),
    scriptKeys,
  );
  for (let key of SERVER_KEYS.filter((key) => key !== PackageKey.BUILD)) {
    assert.deepEqual(
      keyValue(migrated, key),
      keyValue(JSON.parse(rendered("base", SERVER_PACKAGE)), key),
    );
  }
  assert.match(output, /Merge before building/);
  assert.ok(output.includes(`${SERVER_PACKAGE}: scripts.build`), output);
  assert.ok(output.includes(JSON.stringify("project-build")), output);
  assert.ok(
    output.includes(
      JSON.stringify(
        keyValue(
          JSON.parse(rendered("base", SERVER_PACKAGE)),
          PackageKey.BUILD,
        ),
      ),
    ),
    output,
  );
  assert.equal(existsSync(join(dir, SERVER_PACKAGE + ".new")), false);
});

test("CommonJS review reports executable globals and ignores strings, comments, merge files and rewritten files", (t) => {
  let dir = fixture(t, PublishedRelease.V031);
  let serverPath = "apps/server/src/project-commonjs.ts";
  let libPath = "apps/shared/lib/src/project-commonjs.ts";
  let jsPath = "apps/server/project-commonjs.js";
  writeFileSync(
    join(dir, serverPath),
    [
      'let literal = "__dirname require( exports.value module.exports";',
      "let directory = __dirname;",
      'let loaded = require("project");',
      'let text = `require("ignored") ${__filename}`;',
      "let joined = /* ignored __dirname */ __filename;",
      "let ignored = /require\\(.*exports\\./;",
      'let quotePattern = /"/; let directoryAfterPattern = __dirname;',
      "let commentPattern = /[/*]/;",
      'let afterPattern = require("project");',
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, libPath),
    'let filename = __filename;\nlet resolved = require.resolve("project");\n',
  );
  writeFileSync(
    join(dir, jsPath),
    "module.exports = {};\nexports.project = true;\n",
  );
  writeFileSync(join(dir, serverPath + ".new"), "__dirname;\n");
  record(dir);
  let output = add(dir);
  assert.match(output, /CommonJS review/);
  for (let replacement of [
    "import.meta.dirname",
    "import.meta.filename",
    "await import()",
    "export",
  ]) {
    assert.ok(output.includes(replacement), output);
  }
  for (let [path, lines] of [
    [serverPath, [2, 3, 4, 5, 7, 9]],
    [libPath, [1, 2]],
    [jsPath, [1, 2]],
  ] as const) {
    for (let line of lines)
      assert.ok(output.includes(`${path}:${line}`), output);
  }
  assert.doesNotMatch(
    output,
    /apps\/server\/src\/project-commonjs\.ts:1(?:\D|$)/,
  );
  assert.doesNotMatch(
    output,
    /apps\/server\/src\/project-commonjs\.ts:6(?:\D|$)/,
  );
  assert.doesNotMatch(output, /project-commonjs\.ts\.new:\d/);
  assert.doesNotMatch(output, /process-config\.test\.ts:\d/);
  assert.doesNotMatch(output, /apps\/server\/src\/backend\.ts:\d/);
});

for (let { name, content, line } of [
  {
    name: "a regex after a control condition",
    content: 'if (true) /"/.test("text");\nconsole.log(__dirname);\n',
    line: 2,
  },
  {
    name: "division with a string operand",
    content: 'let n = "12" / __dirname.length / 2;\n',
    line: 1,
  },
]) {
  test(`CommonJS review detects globals after ${name}`, (t) => {
    let dir = fixture(t, PublishedRelease.V031);
    let path = "apps/server/src/project-syntax.ts";
    writeFileSync(join(dir, path), content);
    record(dir);
    let output = add(dir);
    assert.ok(
      output.includes(`${path}:${line}`),
      `Expected CommonJS review entry ${path}:${line}`,
    );
  });

  test(`an edited backend with ${name} still needs migration`, (t) => {
    let dir = fixture(t, PublishedRelease.V031);
    let edited = rendered("base", BACKEND) + "\n" + content;
    writeFileSync(join(dir, BACKEND), edited);
    record(dir);
    let output = add(dir);
    assert.equal(readFileSync(join(dir, BACKEND), "utf8"), edited);
    assert.ok(
      existsSync(join(dir, BACKEND + ".new")),
      `Expected ${BACKEND}.new for executable CommonJS`,
    );
    assert.equal(
      readFileSync(join(dir, BACKEND + ".new"), "utf8"),
      rendered("base", BACKEND),
    );
    assert.ok(output.includes(`${BACKEND}.new:`), output);
  });
}

test("CommonJS review distinguishes references from property names and literal text", (t) => {
  let dir = fixture(t, PublishedRelease.V031);
  let path = "apps/server/src/project-properties.ts";
  writeFileSync(
    join(dir, path),
    [
      'let keys = { __dirname: "dir", __filename() {}, require: true };',
      'let properties = [x.__dirname, x.__filename, x.require("x"), x.require.resolve("x"), x.module.exports, x.exports.value];',
      'let text = `__dirname __filename require("x") module.exports exports.value`;',
      "let pattern = /__dirname|__filename|require|module.exports|exports.value/;",
      'class Project { __dirname = "dir"; require() {} }',
      "let shorthand = { __dirname };",
      "let computed = { [__filename]: true };",
      "let load = require;",
      'let interpolated = `${require.resolve("x")}`;',
      "let computedMember = x[__dirname];",
      "",
    ].join("\n"),
  );
  record(dir);
  let output = add(dir);
  let lines = [...output.matchAll(/project-properties\.ts:(\d+)\b/g)].map(
    (hit) => Number(hit[1]),
  );
  assert.deepEqual(lines, [6, 7, 8, 9, 10]);
});

test("CommonJS review ignores declared parameter and local names", (t) => {
  let dir = fixture(t, PublishedRelease.V031);
  let path = "apps/server/src/project-declarations.ts";
  writeFileSync(
    join(dir, path),
    [
      "function project(require: unknown, exports: unknown, __dirname: string) {}",
      "let require: unknown;",
      "let exports: unknown;",
      "let __filename: string;",
      "function destructured({ require, exports }: { require: unknown; exports: unknown }) {}",
      "",
    ].join("\n"),
  );
  record(dir);
  let output = add(dir);
  assert.doesNotMatch(output, /project-declarations\.ts:\d/);
  assert.doesNotMatch(output, /CommonJS review/);
});

test("CommonJS review lists every named lodash import in a project route", (t) => {
  let dir = fixture(t, PublishedRelease.V031);
  let path = "apps/server/src/handlers/project.route.ts";
  writeFileSync(
    join(dir, path),
    [
      'import lodash from "lodash";',
      'import { sortBy } from "lodash";',
      "",
      'import { groupBy } from "lodash";',
      "",
    ].join("\n"),
  );
  record(dir);
  let output = add(dir);
  for (let line of [2, 4]) {
    assert.ok(
      output.includes(
        `${path}:${line}: ES modules need the default import (import lodash from "lodash")`,
      ),
      `Expected default lodash import advice at ${path}:${line}`,
    );
  }
  assert.doesNotMatch(output, /project\.route\.ts:1\b/);
});

for (let { name, path, compilerOptions } of [
  {
    name: "server bundler resolution without noEmit",
    path: "apps/server/tsconfig.json",
    compilerOptions: { moduleResolution: ModuleResolution.BUNDLER },
  },
  {
    name: "lib bundler resolution with composite enabled",
    path: "apps/shared/lib/tsconfig.json",
    compilerOptions: {
      moduleResolution: ModuleResolution.BUNDLER,
      composite: true,
    },
  },
]) {
  test(`${name} does not satisfy migration`, (t) => {
    let dir = fixture(t, PublishedRelease.V031);
    writePackage(dir, path, { compilerOptions });
    let content = readFileSync(join(dir, path), "utf8");
    record(dir);
    let output = add(dir);
    assert.equal(readFileSync(join(dir, path), "utf8"), content);
    assert.ok(
      existsSync(join(dir, path + ".new")),
      `Expected ${path}.new for ${name}`,
    );
    assert.equal(
      readFileSync(join(dir, path + ".new"), "utf8"),
      rendered("base", path),
    );
    assert.match(output, /Merge before building/);
    assert.ok(output.includes(`${path}.new:`), output);
  });
}

test("commented server tsconfig settings require a replacement and merge entry", (t) => {
  let dir = fixture(t, PublishedRelease.V031);
  let path = "apps/server/tsconfig.json";
  let content = readFileSync(join(dir, path), "utf8").replace(
    "{",
    '{\n    // "moduleResolution": "bundler", "noEmit": true',
  );
  writeFileSync(join(dir, path), content);
  record(dir);
  let output = add(dir);
  assert.equal(readFileSync(join(dir, path), "utf8"), content);
  assert.ok(
    existsSync(join(dir, path + ".new")),
    `Expected ${path}.new because commented settings are inactive`,
  );
  assert.equal(
    readFileSync(join(dir, path + ".new"), "utf8"),
    rendered("base", path),
  );
  assert.ok(output.includes(`${path}.new:`), output);
});

for (let { name, path, content } of [
  {
    name: "a commented-out SwaggerSecurityType enum",
    path: "apps/server/src/app/swagger.ts",
    content: '// export enum SwaggerSecurityType { API_KEY = "api_key" }\n',
  },
  {
    name: "a named lodash import",
    path: "apps/server/src/app/swagger.ts",
    content:
      'import lodash, { sortBy } from "lodash";\nexport enum SwaggerSecurityType { API_KEY = "api_key" }\n',
  },
  {
    name: "a commented-out CliErrorCode enum",
    path: "apps/server/src/cli-error-code.ts",
    content:
      '// export enum CliErrorCode { DUPLICATED_COMMAND = "DUPLICATED_CLI_COMMAND" }\n',
  },
  {
    name: "a commented-out CliErrorCode member",
    path: "apps/server/src/cli-error-code.ts",
    content:
      'export enum CliErrorCode {\n// DUPLICATED_COMMAND = "DUPLICATED_CLI_COMMAND"\n}\n',
  },
]) {
  test(`${name} does not satisfy the migration prerequisite`, (t) => {
    let dir = fixture(t, PublishedRelease.V031);
    writeFileSync(join(dir, path), content);
    record(dir);
    let output = add(dir);
    assert.equal(readFileSync(join(dir, path), "utf8"), content);
    assert.ok(
      existsSync(join(dir, path + ".new")),
      `Expected ${path}.new for ${name}`,
    );
    assert.equal(
      readFileSync(join(dir, path + ".new"), "utf8"),
      rendered("base", path),
    );
    assert.ok(output.includes(`${path}.new:`), output);
  });
}

test("unparseable TypeScript is reported and cannot satisfy a prerequisite", (t) => {
  let dir = fixture(t, PublishedRelease.V031);
  let content = rendered("base", BACKEND) + "\nlet broken = ;\n";
  writeFileSync(join(dir, BACKEND), content);
  record(dir);
  let output = add(dir);
  assert.match(output, /apps\/server\/src\/backend\.ts[^\n]*parse failure/i);
  assert.equal(readFileSync(join(dir, BACKEND), "utf8"), content);
  assert.ok(
    existsSync(join(dir, BACKEND + ".new")),
    `Expected ${BACKEND}.new for unparseable TypeScript`,
  );
  assert.equal(
    readFileSync(join(dir, BACKEND + ".new"), "utf8"),
    rendered("base", BACKEND),
  );
});

test("active JSONC settings and parsed TypeScript predicates preserve satisfied edits", (t) => {
  let dir = fixture(t, PublishedRelease.V031);
  let contents = new Map([
    [
      "apps/server/tsconfig.json",
      '{\n// project settings\n"compilerOptions": { "moduleResolution": "Bundler", /* active */ "noEmit": true, }, "project": "https://example.invalid/*config*/,}",\n}\n',
    ],
    [
      "apps/server/tsconfig.build.json",
      '{ /* "references": [] */ "extends": "./project.json", }\n',
    ],
    [
      "apps/shared/lib/tsconfig.json",
      '{ "compilerOptions": { "moduleResolution": "BUNDLER", "composite": false, }, }\n',
    ],
    [
      "apps/server/src/app/swagger.ts",
      rendered("base", "apps/server/src/app/swagger.ts") +
        '\n// import { sortBy } from "lodash";\n',
    ],
  ]);
  for (let [path, content] of contents) {
    writeFileSync(join(dir, path), content);
  }
  record(dir);
  let output = add(dir);
  for (let [path, content] of contents) {
    assert.equal(readFileSync(join(dir, path), "utf8"), content, path);
    assert.equal(existsSync(join(dir, path + ".new")), false, path);
  }
  assert.doesNotMatch(output, /Merge before building/);
});

for (let path of [
  "apps/server/tsconfig.json",
  "apps/server/tsconfig.build.json",
  "apps/shared/lib/tsconfig.json",
]) {
  test(`unparseable ${path} cannot satisfy migration`, (t) => {
    let dir = fixture(t, PublishedRelease.V031);
    let content =
      '{ "compilerOptions": { "moduleResolution": "bundler", "noEmit": true }\n';
    writeFileSync(join(dir, path), content);
    record(dir);
    let output = add(dir);
    assert.equal(readFileSync(join(dir, path), "utf8"), content);
    assert.ok(
      existsSync(join(dir, path + ".new")),
      `Expected ${path}.new for unparseable JSONC`,
    );
    assert.ok(output.includes(`${path}.new:`), output);
  });
}

test("custom package values and project-deleted keys are kept and reported against the expected values", (t) => {
  let dir = fixture(t, PublishedRelease.V031);
  let server = readPackage(dir, SERVER_PACKAGE);
  server.type = PackageModuleType.COMMONJS;
  let scripts = server.scripts as JsonRecord;
  scripts["build:clean"] = "project-clean";
  delete scripts["type-check"];
  writePackage(dir, SERVER_PACKAGE, server);
  let lib = readPackage(dir, LIB_PACKAGE);
  let exports = { "./project": "./project.js" };
  lib.exports = exports;
  writePackage(dir, LIB_PACKAGE, lib);
  record(dir);
  let output = add(dir);
  let plainOutput = output.replaceAll("│", "").replace(/\s+/g, " ");
  let migratedServer = readPackage(dir, SERVER_PACKAGE);
  let migratedLib = readPackage(dir, LIB_PACKAGE);
  assert.equal(migratedServer.type, PackageModuleType.COMMONJS);
  assert.equal(
    keyValue(migratedServer, PackageKey.BUILD_CLEAN),
    "project-clean",
  );
  assert.equal(keyValue(migratedServer, PackageKey.TYPE_CHECK), undefined);
  assert.deepEqual(migratedLib.exports, exports);
  assert.equal(migratedLib.type, PackageModuleType.MODULE);
  for (let key of [
    PackageKey.BUILD,
    PackageKey.BUILD_WATCH,
    PackageKey.ROLLDOWN,
  ]) {
    assert.deepEqual(
      keyValue(migratedServer, key),
      keyValue(JSON.parse(rendered("base", SERVER_PACKAGE)), key),
      key,
    );
  }
  assert.match(output, /Merge before building/);
  assert.ok(
    plainOutput.includes(
      `${SERVER_PACKAGE}: type kept as "commonjs" (expected "module")`,
    ),
    output,
  );
  assert.ok(
    plainOutput.includes(
      `${SERVER_PACKAGE}: scripts.build:clean kept as "project-clean" (expected "rm -rf dist && npm run build")`,
    ),
    output,
  );
  assert.ok(
    plainOutput.includes(
      `${SERVER_PACKAGE}: scripts.type-check kept as absent`,
    ),
    output,
  );
  assert.ok(
    plainOutput.includes(
      `${LIB_PACKAGE}: exports kept as ${JSON.stringify(exports)}`,
    ),
    output,
  );
});

test("adding cache leaves published CommonJS migration files and package keys alone", (t) => {
  let dir = fixture(t, PublishedRelease.V031);
  let paths = [
    ...FILE_PREREQUISITES.filter((path) => existsSync(join(dir, path))),
    LIB_PACKAGE,
  ];
  let originals = new Map(
    paths.map((path) => [path, readFileSync(join(dir, path), "utf8")]),
  );
  let originalServer = readPackage(dir, SERVER_PACKAGE);
  record(dir);
  let output = add(dir, AddFeature.CACHE);
  for (let [path, original] of originals) {
    assert.equal(readFileSync(join(dir, path), "utf8"), original, path);
    assert.equal(existsSync(join(dir, path + ".new")), false, path);
  }
  for (let key of SERVER_KEYS) {
    assert.deepEqual(
      keyValue(readPackage(dir, SERVER_PACKAGE), key),
      keyValue(originalServer, key),
      key,
    );
  }
  assert.equal(readPackage(dir, SERVER_PACKAGE).type, undefined);
  assert.equal(readPackage(dir, LIB_PACKAGE).type, undefined);
  assert.equal(existsSync(join(dir, "apps/server/rolldown.config.ts")), false);
  assert.doesNotMatch(output, /CommonJS review|npm run type-check/);
});

test("fresh ES module scaffolds add workers without migrating or scanning project files", (t) => {
  let dir = fixture(t);
  let projectPath = "apps/server/src/project-commonjs.ts";
  writeFileSync(join(dir, projectPath), "let directory = __dirname;\n");
  record(dir);
  let output = add(dir);
  assertPackageKeys(dir);
  assert.doesNotMatch(
    output,
    /support the ES module server build|CommonJS review|npm run type-check/,
  );
  assert.deepEqual(
    files(dir).filter((path) => path.endsWith(".new")),
    [],
    output,
  );
});

test("adding workers to a fresh ES module scaffold equals generating with workers", (t) => {
  let added = fixture(t);
  record(added);
  add(added);
  let generated = scaffold(t);
  let result = command(generated, process.execPath, [
    CLI,
    NAME,
    "--yes",
    "--db",
    Database.MONGO,
    "--ci",
    Ci.NONE,
    "--workers",
    "--no-cache",
    "--no-rate-limit",
    "--no-websockets",
    "--no-install",
    "--dir",
    generated,
  ]);
  assert.equal(result.status, 0, result.output);
  let paths = files(generated).sort();
  assert.deepEqual(files(added).sort(), paths);
  for (let path of paths) {
    assert.deepEqual(
      readFileSync(join(added, path)),
      readFileSync(join(generated, path)),
      path,
    );
  }
});

test("satisfied edited migration prerequisites stay project-owned while missing files are supplied", (t) => {
  let dir = fixture(t, PublishedRelease.V031);
  let paths = FILE_PREREQUISITES.filter((path) => !path.endsWith(".json"));
  let originals = new Map<string, string>();
  for (let path of paths) {
    let content =
      rendered("base", path) + '\nexport const PROJECT_LABEL = "custom";\n';
    writeFileSync(join(dir, path), content);
    originals.set(path, content);
  }
  let serverConfig = "apps/server/tsconfig.json";
  let libConfig = "apps/shared/lib/tsconfig.json";
  let configs = [
    [
      serverConfig,
      {
        compilerOptions: { moduleResolution: "Bundler", noEmit: true },
        project: true,
      },
    ],
    [
      libConfig,
      { compilerOptions: { moduleResolution: "BUNDLER" }, project: true },
    ],
    [
      "apps/server/tsconfig.build.json",
      { extends: "./project.json", project: true },
    ],
  ] as const;
  for (let [path, content] of configs) {
    writePackage(dir, path, content);
    originals.set(path, readFileSync(join(dir, path), "utf8"));
  }
  let missing = "apps/server/src/app/swagger.ts";
  originals.delete(missing);
  rmSync(join(dir, missing));
  record(dir);
  let output = add(dir);
  for (let [path, content] of originals) {
    assert.equal(readFileSync(join(dir, path), "utf8"), content, path);
    assert.equal(existsSync(join(dir, path + ".new")), false, path);
  }
  assert.equal(
    readFileSync(join(dir, missing), "utf8"),
    rendered("base", missing),
  );
  assert.doesNotMatch(output, /Merge before building/);
});
