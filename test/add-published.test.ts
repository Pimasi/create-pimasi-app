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
import { applyReplacements, buildReplacements } from "../src/compose.js";
import { AddFeature, Ci, Command, Database } from "../src/types.js";

enum PublishedRelease {
  V020 = "0.2.0",
  V030 = "0.3.0",
}

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CLI = join(ROOT, "dist/index.js");
const RELEASES = join(ROOT, "templates/legacy");
const NAME = "published-add";
const WIRE = "apps/shared/lib/src/values/wire.ts";
const ENV = "apps/server/src/utils/env.ts";
const ENV_TEST = "apps/server/src/utils/env.test.ts";
const LIMITER = "apps/server/src/middleware/rate-limit.ts";
const LIMITER_TEST = "apps/server/src/middleware/rate-limit.test.ts";
const AUTH_ROUTES = [
  "apps/server/src/handlers/auth/confirm-password-reset.route.ts",
  "apps/server/src/handlers/auth/login-with-firebase.route.ts",
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

function rendered(fragment: string, path: string) {
  return applyReplacements(
    readFileSync(
      fragment.startsWith("legacy/")
        ? join(RELEASES, fragment.slice("legacy/".length), path)
        : join(ROOT, "templates", fragment, path),
      "utf8",
    ),
    buildReplacements(NAME),
  );
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

function fixture(
  t: TestContext,
  release = PublishedRelease.V030,
  host = Ci.NONE,
  rateLimit = true,
  database = Database.MONGO,
) {
  let dir = mkdtempSync(join(tmpdir(), "published-add-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let result = command(dir, process.execPath, [
    CLI,
    NAME,
    "--yes",
    "--db",
    database,
    "--ci",
    host,
    ...(rateLimit ? [] : ["--no-rate-limit"]),
    "--no-cache",
    "--no-install",
    "--dir",
    dir,
  ]);
  assert.equal(result.status, 0, result.output);
  for (let fragment of [
    "base",
    `db/${database}`,
    ...(rateLimit ? ["server/redis", "server/rate-limit"] : []),
    "frontend/tanstack",
    "design/shadcn/tanstack",
  ]) {
    let legacyFragment = `legacy/${release}/${fragment}`;
    for (let path of files(join(RELEASES, release, fragment))) {
      if (path === "README.md") continue;
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), rendered(legacyFragment, path));
    }
  }
  for (let path of [
    WIRE,
    "apps/shared/lib/src/values/health.ts",
    "apps/server/src/app/route-values.ts",
    "apps/server/src/middleware/rate-limit-key.ts",
    "apps/server/src/utils/token-type.ts",
  ]) {
    rmSync(join(dir, path), { force: true });
  }
  if (release === PublishedRelease.V020) {
    rmSync(join(dir, ENV_TEST), { force: true });
    rmSync(join(dir, LIMITER_TEST), { force: true });
  }
  return dir;
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
      "test: record published render",
    ],
  ]) {
    let result = command(dir, "git", args);
    assert.equal(result.status, 0, result.output);
  }
}

function add(dir: string, feature: AddFeature | AddFeature[], refresh = false) {
  let result = command(dir, process.execPath, [
    CLI,
    Command.ADD,
    ...(Array.isArray(feature) ? feature : [feature]),
    "--yes",
    "--no-install",
    ...(refresh ? ["--refresh"] : []),
  ]);
  assert.equal(result.status, 0, result.output);
  return result.output;
}

function assertLimiterPair(dir: string) {
  assert.ok(existsSync(join(dir, WIRE)), WIRE);
  assert.equal(readFileSync(join(dir, WIRE), "utf8"), rendered("base", WIRE));
  assert.equal(
    readFileSync(join(dir, LIMITER), "utf8"),
    rendered("server/rate-limit", LIMITER),
  );
  assert.equal(
    readFileSync(join(dir, LIMITER_TEST), "utf8"),
    rendered("server/rate-limit", LIMITER_TEST),
  );
  assert.match(readFileSync(join(dir, ENV), "utf8"), /export enum NodeEnv/);
  assert.match(
    readFileSync(join(dir, LIMITER), "utf8"),
    /export enum RateLimitErrorCode/,
  );
  for (let path of [
    "apps/server/src/app/route-values.ts",
    "apps/server/src/middleware/rate-limit-key.ts",
  ]) {
    assert.equal(readFileSync(join(dir, path), "utf8"), rendered("base", path));
  }
}

for (let database of [Database.MONGO, Database.POSTGRES]) {
  test(`0.3.0 ${database}: add rate-limit upgrades published environment and auth routes in place`, (t) => {
    let dir = fixture(t, PublishedRelease.V030, Ci.NONE, false, database);
    record(dir);
    let output = add(dir, AddFeature.RATE_LIMIT);
    assert.deepEqual(
      files(dir).filter((path) => path.endsWith(".new")),
      [],
      output,
    );
    assert.equal(
      readFileSync(join(dir, ENV), "utf8"),
      rendered(`db/${database}`, ENV),
    );
    assert.equal(
      readFileSync(join(dir, ENV_TEST), "utf8"),
      rendered("base", ENV_TEST),
    );
    for (let path of AUTH_ROUTES) {
      assert.equal(
        readFileSync(join(dir, path), "utf8"),
        rendered("base", path),
      );
    }
    assertLimiterPair(dir);
  });
}

for (let refresh of [false, true]) {
  test(`0.3.0: CI ${refresh ? "refresh" : "adoption"} upgrades published limiter and test together without merge files`, (t) => {
    let dir = fixture(t, PublishedRelease.V030, refresh ? Ci.GITHUB : Ci.NONE);
    record(dir);
    let output = add(dir, AddFeature.CI_GITHUB, refresh);
    assert.deepEqual(
      files(dir).filter((path) => path.endsWith(".new")),
      [],
      output,
    );
    assertLimiterPair(dir);
  });
}

test("0.3.0 without rate limiting: adopting GitLab upgrades published environment in place", (t) => {
  let dir = fixture(t, PublishedRelease.V030, Ci.NONE, false);
  record(dir);
  let output = add(dir, AddFeature.CI_GITLAB);
  assert.deepEqual(
    files(dir).filter((path) => path.endsWith(".new")),
    [],
    output,
  );
  assert.ok(existsSync(join(dir, WIRE)), WIRE);
  assert.equal(readFileSync(join(dir, WIRE), "utf8"), rendered("base", WIRE));
  assert.equal(readFileSync(join(dir, ENV), "utf8"), rendered("db/mongo", ENV));
  assert.equal(existsSync(join(dir, LIMITER_TEST)), false);
});

test("0.2.0 default: adopting GitHub upgrades published middleware beside its enum test", (t) => {
  let dir = fixture(t, PublishedRelease.V020);
  record(dir);
  let output = add(dir, AddFeature.CI_GITHUB);
  assert.deepEqual(
    files(dir).filter((path) => path.endsWith(".new")),
    [],
    output,
  );
  assertLimiterPair(dir);
});

test("0.3.0: adding all server features installs wire pins beside their dependencies", (t) => {
  let dir = fixture(t, PublishedRelease.V030, Ci.NONE, false);
  record(dir);
  let output = add(dir, [
    AddFeature.WORKERS,
    AddFeature.CACHE,
    AddFeature.RATE_LIMIT,
    AddFeature.WEBSOCKETS,
  ]);
  assert.deepEqual(
    files(dir).filter((path) => path.endsWith(".new")),
    [],
    output,
  );
  assertLimiterPair(dir);
  for (let path of [
    "apps/shared/lib/src/values/health.ts",
    "apps/server/src/utils/token-type.ts",
  ]) {
    assert.equal(readFileSync(join(dir, path), "utf8"), rendered("base", path));
  }
});

for (let path of AUTH_ROUTES) {
  for (let refresh of [false, true]) {
    test(`deleted ${path}: stays deleted across ${refresh ? "refresh" : "add rate-limit"}`, (t) => {
      let dir = fixture(
        t,
        PublishedRelease.V030,
        refresh ? Ci.GITHUB : Ci.NONE,
        refresh,
      );
      rmSync(join(dir, path));
      record(dir);
      add(dir, refresh ? AddFeature.CI_GITHUB : AddFeature.RATE_LIMIT, refresh);
      assert.equal(
        existsSync(join(dir, path)),
        false,
        "deleted route was recreated",
      );
      assert.equal(existsSync(join(dir, path + ".new")), false);
    });
  }
}

for (let upgrading of [false, true]) {
  test(`edited literal auth route: refresh merge file requires limiter upgrade=${upgrading}`, (t) => {
    let dir = fixture(t, PublishedRelease.V030, Ci.GITHUB);
    let path = AUTH_ROUTES[1];
    let content = readFileSync(join(dir, path), "utf8").replace(
      "max: 30,",
      "max: 40,",
    );
    writeFileSync(join(dir, path), content);
    if (!upgrading) {
      for (let [fragment, relPath] of [
        ["db/mongo", ENV],
        ["base", ENV_TEST],
        ["server/rate-limit", LIMITER],
        ["server/rate-limit", LIMITER_TEST],
        ["base", "apps/server/src/app/route-values.ts"],
        ["base", "apps/server/src/middleware/rate-limit-key.ts"],
      ]) {
        writeFileSync(join(dir, relPath), rendered(fragment, relPath));
      }
    }
    record(dir);
    let output = add(dir, AddFeature.CI_GITHUB, true);
    assert.equal(readFileSync(join(dir, path), "utf8"), content);
    assert.deepEqual(
      files(dir)
        .filter((relPath) => relPath.endsWith(".new"))
        .sort(),
      upgrading ? [path + ".new"] : [],
      output,
    );
    if (upgrading) {
      assert.equal(
        readFileSync(join(dir, path + ".new"), "utf8"),
        rendered("base", path),
      );
      assert.match(output, /Merge before your first gate run or release/);
    }
  });
}

enum EnvironmentExport {
  NODE_ENV = "NodeEnv",
  BOOLEAN = "EnvironmentBoolean",
}

for (let missing of Object.values(EnvironmentExport)) {
  test(`edited published environment: missing ${missing} flags the environment beside the limiter upgrade`, (t) => {
    let dir = fixture(t, PublishedRelease.V030, Ci.NONE, false);
    let incoming = rendered("db/mongo", ENV);
    let present =
      missing === EnvironmentExport.NODE_ENV
        ? EnvironmentExport.BOOLEAN
        : EnvironmentExport.NODE_ENV;
    let declaration = incoming.match(
      new RegExp(`export enum ${present} \\{[^}]*\\}`),
    );
    assert.ok(declaration);
    let content = readFileSync(join(dir, ENV), "utf8");
    if (present === EnvironmentExport.NODE_ENV) {
      content = content.replace(
        /const VALID_NODE_ENVS = [^\n]*;\ntype NodeEnv = [^\n]*;/,
        `${declaration[0]}\nconst VALID_NODE_ENVS = Object.values(NodeEnv);`,
      );
    } else {
      content += `\n${declaration[0]}\n`;
    }
    content += '\nexport const PROJECT_ENV_LABEL = "custom";\n';
    writeFileSync(join(dir, ENV), content);
    record(dir);
    let output = add(dir, AddFeature.RATE_LIMIT);
    assert.equal(readFileSync(join(dir, ENV), "utf8"), content);
    assert.equal(existsSync(join(dir, ENV + ".new")), true, output);
    assert.equal(readFileSync(join(dir, ENV + ".new"), "utf8"), incoming);
    assert.equal(
      readFileSync(join(dir, LIMITER), "utf8"),
      rendered("server/rate-limit", LIMITER),
    );
    assert.ok(output.includes(ENV + ".new:"), output);
    assert.ok(output.includes(LIMITER + ":"), output);
  });
}

test("edited published middleware: CI reports its missing enum beside the upgraded test", (t) => {
  let dir = fixture(t);
  let content =
    readFileSync(join(dir, LIMITER), "utf8") +
    '\nexport const PROJECT_LIMITER_LABEL = "custom";\n';
  writeFileSync(join(dir, LIMITER), content);
  record(dir);
  let output = add(dir, AddFeature.CI_GITHUB);
  assert.equal(readFileSync(join(dir, LIMITER), "utf8"), content);
  assert.equal(existsSync(join(dir, LIMITER + ".new")), true, output);
  assert.equal(
    readFileSync(join(dir, LIMITER + ".new"), "utf8"),
    rendered("server/rate-limit", LIMITER),
  );
  assert.equal(
    readFileSync(join(dir, LIMITER_TEST), "utf8"),
    rendered("server/rate-limit", LIMITER_TEST),
  );
  assert.ok(output.includes(LIMITER + ".new:"), output);
  assert.ok(output.includes(LIMITER_TEST + ":"), output);
});
