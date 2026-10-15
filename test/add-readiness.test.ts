import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const LEGACY_PING = fileURLToPath(
  new URL(
    "../templates/legacy/0.2.0/base/apps/server/src/handlers/ping.route.ts",
    import.meta.url,
  ),
);
const READINESS_FILES = [
  "apps/server/src/app/readiness.ts",
  "apps/server/src/app/readiness.test.ts",
  "apps/server/src/handlers/ready.route.ts",
  "apps/server/src/handlers/ready.test.ts",
  "apps/shared/lib/src/schemas/api/ready-response.schema.ts",
  "apps/server/src/services/database-readiness.boot.ts",
  "apps/server/src/services/database-readiness.test.ts",
  "apps/server/src/services/redis-readiness.boot.ts",
  "apps/server/src/services/redis-readiness.test.ts",
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

function fixture(t: TestContext, database: string, args: string[] = []) {
  let dir = mkdtempSync(join(tmpdir(), "g1-readiness-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let generated = command(dir, process.execPath, [
    CLI,
    "g1-readiness",
    "--yes",
    "--db",
    database,
    "--ci",
    "none",
    "--no-install",
    "--dir",
    dir,
    ...args,
  ]);
  assert.equal(generated.status, 0, generated.output);
  return dir;
}

for (let axis of ["cache", "workers", "rate-limit", "websockets"]) {
  test(`${axis}: first Redis feature brings missing readiness prerequisites`, async (t) => {
    let dir = fixture(t, "mongo", ["--no-cache", "--no-rate-limit"]);
    let pingPath = join(dir, "apps/server/src/handlers/ping.route.ts");
    let legacyPing = readFileSync(LEGACY_PING, "utf8").replaceAll(
      "@pimasi/lib",
      "@g1-readiness/lib",
    );
    writeFileSync(pingPath, legacyPing);
    for (let path of READINESS_FILES) {
      rmSync(join(dir, path), { force: true });
    }
    record(dir);
    let result = command(dir, process.execPath, [
      CLI,
      "add",
      axis,
      "--yes",
      "--no-install",
    ]);
    assert.equal(result.status, 0, result.output);
    for (let path of READINESS_FILES) {
      assert.equal(existsSync(join(dir, path)), true, path);
      assert.equal(existsSync(join(dir, path + ".new")), false, path);
    }
    assert.equal(readFileSync(pingPath, "utf8"), legacyPing);
    await assertLegacyLiveness(
      readFileSync(join(dir, "apps/server/src/handlers/ready.test.ts"), "utf8"),
    );
  });
}

async function assertLegacyLiveness(source: string) {
  let requests: string[] = [];
  let expect = Object.assign(
    (actual: unknown) => ({
      toBe: (expected: unknown) => assert.equal(actual, expected),
      toEqual: (expected: unknown) => assert.deepEqual(actual, expected),
    }),
    { any: (type: unknown) => type },
  );
  let http = async ({ url }: { url: string }) => {
    requests.push(url.endsWith("/ping") ? "/ping" : "/ready");
    return url.endsWith("/ping")
      ? { status: 200, data: { message: "pong" } }
      : {
          status: 503,
          data: {
            status: "unavailable",
            checks: { database: "failed", independent: "ok" },
          },
        };
  };
  let liveness = source.match(
    /it\("returns 503 for a failing database check without affecting liveness", async \(\) => \{([\s\S]*?)\n    \}\);/,
  );
  assert.ok(
    liveness,
    "readiness suite must exercise failed dependency liveness",
  );
  await new Function(
    "http",
    "registerReadinessCheck",
    "expect",
    "baseUrl",
    `return (async () => {${liveness[1]}})();`,
  )(http, () => () => {}, expect, "http://legacy.invalid");
  assert.deepEqual(requests, ["/ready", "/ping"]);
}

for (let satisfied of [true, false]) {
  test(`first Redis feature preserves edited readiness prerequisites: satisfied=${satisfied}`, (t) => {
    let dir = fixture(t, "postgres", ["--no-cache", "--no-rate-limit"]);
    let originals = new Map<string, string>();
    for (let path of READINESS_FILES.slice(0, -2)) {
      let content =
        (satisfied ? readFileSync(join(dir, path), "utf8") : "") +
        '\nexport const PROJECT_READINESS_LABEL = "custom";\n';
      writeFileSync(join(dir, path), content);
      originals.set(path, content);
    }
    record(dir);
    let result = command(dir, process.execPath, [
      CLI,
      "add",
      "cache",
      "--yes",
      "--no-install",
    ]);
    assert.equal(result.status, 0, result.output);
    for (let [path, content] of originals) {
      assert.equal(readFileSync(join(dir, path), "utf8"), content, path);
      assert.equal(existsSync(join(dir, path + ".new")), !satisfied, path);
    }
    if (satisfied) {
      assert.doesNotMatch(result.output, /Merge before building/);
    } else {
      assert.match(result.output, /Merge before building/);
      assert.doesNotMatch(result.output, /Merge before your first release/);
    }
  });
}

for (let [database, frontend] of [
  ["mongo", "nextjs"],
  ["postgres", "tanstack"],
]) {
  test(`${database}: every satisfied edited release prerequisite has a content rule`, (t) => {
    let dir = fixture(t, database, ["--frontend", frontend]);
    let paths = [
      ".gitignore",
      "apps/server/.gitignore",
      "Dockerfile.server",
      "Dockerfile.web",
      "apps/server/process.config.js",
      "apps/server/src/app/process-config.test.ts",
      "apps/server/src/handlers/ping.route.ts",
      "apps/server/src/handlers/ping.test.ts",
      "apps/shared/lib/src/schemas/api/ping-response.schema.ts",
      "apps/server/src/utils/env.ts",
      ...READINESS_FILES,
      ...(frontend === "nextjs" ? ["apps/web/tsconfig.json"] : []),
    ];
    let originals = new Map<string, string>();
    for (let path of paths) {
      let content = readFileSync(join(dir, path), "utf8");
      if (path.endsWith(".json")) {
        content =
          JSON.stringify({ ...JSON.parse(content), project: true }, null, 4) +
          "\n";
      } else {
        content += path.includes("Dockerfile")
          ? "\nRUN true\n"
          : path.endsWith(".gitignore")
            ? "\nproject-local/\n"
            : path.endsWith(".js")
              ? "\nmodule.exports.project = true;\n"
              : '\nexport const PROJECT_RELEASE_LABEL = "custom";\n';
      }
      writeFileSync(join(dir, path), content);
      originals.set(path, content);
    }
    record(dir);
    let result = command(dir, process.execPath, [
      CLI,
      "add",
      "ci-github",
      "--yes",
      "--no-install",
    ]);
    assert.equal(result.status, 0, result.output);
    for (let [path, content] of originals) {
      assert.equal(readFileSync(join(dir, path), "utf8"), content, path);
      assert.equal(existsSync(join(dir, path + ".new")), false, path);
    }
    assert.doesNotMatch(result.output, /Merge before your first release/);
  });
}

test("CI reports an edited process-count test missing its contract", (t) => {
  let dir = fixture(t, "mongo");
  let path = "apps/server/src/app/process-config.test.ts";
  let content = 'export const PROJECT_RELEASE_LABEL = "custom";\n';
  writeFileSync(join(dir, path), content);
  record(dir);
  let result = command(dir, process.execPath, [
    CLI,
    "add",
    "ci-github",
    "--yes",
    "--no-install",
  ]);
  assert.equal(result.status, 0, result.output);
  assert.equal(readFileSync(join(dir, path), "utf8"), content);
  assert.equal(existsSync(join(dir, path + ".new")), true);
  assert.match(result.output, /Merge before your first release/);
});

function record(dir: string) {
  for (let args of [
    ["add", "."],
    [
      "-c",
      "user.name=l1",
      "-c",
      "user.email=l1@example.invalid",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "test: preserve readiness customisations",
    ],
  ]) {
    let result = command(dir, "git", args);
    assert.equal(result.status, 0, result.output);
  }
}

for (let [database, host] of [
  ["mongo", "github"],
  ["postgres", "gitlab"],
]) {
  test(`${database}: adding CI preserves satisfied edited readiness prerequisites`, (t) => {
    let dir = fixture(t, database);
    let originals = new Map<string, string>();
    for (let path of READINESS_FILES) {
      let content =
        readFileSync(join(dir, path), "utf8") +
        '\nexport const PROJECT_READINESS_LABEL = "custom";\n';
      writeFileSync(join(dir, path), content);
      originals.set(path, content);
    }
    record(dir);
    let result = command(dir, process.execPath, [
      CLI,
      "add",
      `ci-${host}`,
      "--yes",
      "--no-install",
    ]);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(
      [...originals.keys()].filter((path) =>
        existsSync(join(dir, path + ".new")),
      ),
      [],
    );
    for (let [path, content] of originals) {
      assert.equal(readFileSync(join(dir, path), "utf8"), content, path);
    }
    assert.doesNotMatch(result.output, /Merge before your first release/);
  });

  test(`${database}: adding CI reports edited readiness files missing their contracts`, (t) => {
    let dir = fixture(t, database);
    let content = 'export const PROJECT_READINESS_LABEL = "custom";\n';
    for (let path of READINESS_FILES) writeFileSync(join(dir, path), content);
    record(dir);
    let result = command(dir, process.execPath, [
      CLI,
      "add",
      `ci-${host}`,
      "--yes",
      "--no-install",
    ]);
    assert.equal(result.status, 0, result.output);
    for (let path of READINESS_FILES) {
      assert.equal(readFileSync(join(dir, path), "utf8"), content, path);
      assert.equal(existsSync(join(dir, path + ".new")), true, path);
      assert.notEqual(
        readFileSync(join(dir, path + ".new"), "utf8"),
        content,
        path,
      );
    }
    assert.match(result.output, /Merge before your first release/);
  });
}
