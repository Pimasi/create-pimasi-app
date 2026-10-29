import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CLI = join(ROOT, "dist/index.js");
const NAME = "g1-ci";

function command(dir: string, executable: string, args: string[]) {
  let result = spawnSync(executable, args, {
    cwd: dir,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

function fixture(t: TestContext, host = "none", args: string[] = []) {
  let dir = mkdtempSync(join(tmpdir(), "g1-ci-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let result = command(dir, process.execPath, [
    CLI,
    NAME,
    "--yes",
    "--ci",
    host,
    "--no-cache",
    "--no-install",
    "--dir",
    dir,
    ...args,
  ]);
  assert.equal(result.status, 0, result.output);
  return dir;
}

function record(dir: string) {
  for (let args of [
    ["add", "."],
    [
      "-c",
      "user.name=g1",
      "-c",
      "user.email=g1@example.invalid",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "test: record CI fixture",
    ],
  ]) {
    let result = command(dir, "git", args);
    assert.equal(result.status, 0, result.output);
  }
}

function add(dir: string, feature: string, args: string[] = []) {
  return command(dir, process.execPath, [
    CLI,
    "add",
    feature,
    "--yes",
    "--no-install",
    ...args,
  ]);
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git") return [];
    return entry.isDirectory()
      ? files(join(dir, entry.name)).map((path) => join(entry.name, path))
      : [entry.name];
  });
}

function rendered(fragment: string, path: string) {
  let content = readFileSync(join(ROOT, "templates", fragment, path), "utf8");
  for (let [before, after] of [
    ["__APP_SLUG__", NAME],
    ["@pimasi/lib", `@${NAME}/lib`],
    ["pimasi-server", `${NAME}-server`],
    ["pimasi-web", `${NAME}-web`],
    ["pimasi-mongo", `${NAME}-mongo`],
    ["pimasi-redis", `${NAME}-redis`],
    ["pimasi-postgres", `${NAME}-postgres`],
    ["pimasi_auth_token", "g1_ci_auth_token"],
  ]) {
    content = content.replaceAll(before, after);
  }
  return content;
}

function assertHostFiles(dir: string, host: string) {
  for (let fragment of ["ci/common", `ci/${host}`]) {
    for (let path of files(join(ROOT, "templates", fragment))) {
      assert.equal(existsSync(join(dir, path)), true, path);
      assert.equal(
        readFileSync(join(dir, path), "utf8"),
        rendered(fragment, path),
        path,
      );
    }
  }
  assert.equal(existsSync(join(dir, ".gitlab-ci.yml")), host === "gitlab");
  assert.equal(
    existsSync(join(dir, ".github/workflows/ci.yml")),
    host === "github",
  );
  assert.equal(
    JSON.parse(readFileSync(join(dir, "pimasi.json"), "utf8")).ci,
    host,
  );
}

for (let host of ["github", "gitlab"]) {
  test(`${host}: scaffold copies the common and selected host fragments`, (t) => {
    let dir = fixture(t, host);
    assertHostFiles(dir, host);
  });

  test(`${host}: add copies the common and selected host fragments`, (t) => {
    let dir = fixture(t);
    record(dir);
    let result = add(dir, `ci-${host}`);
    assert.equal(result.status, 0, result.output);
    assertHostFiles(dir, host);
  });

  test(`${host}: adding equals generating without rate limiting`, (t) => {
    let generated = fixture(t, host, ["--no-rate-limit"]);
    let added = fixture(t, "none", ["--no-rate-limit"]);
    record(added);
    let result = add(added, `ci-${host}`);
    assert.equal(result.status, 0, result.output);
    assert.equal(
      JSON.parse(readFileSync(join(added, "pimasi.json"), "utf8")).rateLimit,
      false,
    );
    let path = "apps/server/src/middleware/rate-limit.ts";
    assert.equal(
      readFileSync(join(added, path), "utf8"),
      rendered("base", path),
    );
    assert.equal(
      existsSync(join(added, "apps/server/src/middleware/rate-limit.test.ts")),
      false,
    );
    assert.deepEqual(
      files(added).filter((path) => path.endsWith(".new")),
      [],
    );
    assert.deepEqual(tree(added), tree(generated));
  });

  test(`${host}: edited unformatted rate-limit middleware has one switch merge note`, async (t) => {
    let database = host === "github" ? "mongo" : "postgres";
    let dir = fixture(t, "none", ["--db", database]);
    let path = "apps/server/src/middleware/rate-limit.ts";
    let content = rendered("server/rate-limit", path)
      .replace(/^.*RATE_LIMIT_ENABLED:.*\n/m, "")
      .replace(/^ \* Set RATE_LIMIT_ENABLED=false.*\n/m, "")
      .replace(" || !$env.RATE_LIMIT_ENABLED", "");
    content = await format(content, { filepath: path, tabWidth: 4 });
    content += '\nexport const PROJECT_SETTING   =   "kept";\n';
    writeFileSync(join(dir, path), content);
    rmSync(join(dir, "apps/server/src/middleware/rate-limit.test.ts"));
    record(dir);
    let result = add(dir, `ci-${host}`);
    assert.equal(result.status, 0, result.output);
    assert.equal(readFileSync(join(dir, path), "utf8"), content);
    assert.equal(existsSync(join(dir, path + ".new")), true);
    assert.equal(
      readFileSync(join(dir, path + ".new"), "utf8"),
      rendered("server/rate-limit", path),
    );
    assert.equal(
      result.output.split(path + ".new").length - 1,
      1,
      result.output,
    );
    let line = result.output
      .replaceAll("│", "")
      .replaceAll(/\s+/g, " ")
      .split(path + ".new: ")[1];
    assert.match(
      line!,
      /^allow and test disabling rate limiting for the CI gate/,
    );
    assert.doesNotMatch(line!, /apply the generated Prettier configuration/);
  });

  test(`${host}: pristine unformatted rate-limit middleware upgrades in place`, async (t) => {
    let database = host === "github" ? "mongo" : "postgres";
    let dir = fixture(t, "none", ["--db", database]);
    let path = "apps/server/src/middleware/rate-limit.ts";
    let content = rendered("server/rate-limit", path)
      .replace(/^.*RATE_LIMIT_ENABLED:.*\n/m, "")
      .replace(/^ \* Set RATE_LIMIT_ENABLED=false.*\n/m, "")
      .replace(" || !$env.RATE_LIMIT_ENABLED", "");
    writeFileSync(
      join(dir, path),
      await format(content, { filepath: path, tabWidth: 2 }),
    );
    record(dir);
    let result = add(dir, `ci-${host}`);
    assert.equal(result.status, 0, result.output);
    assert.equal(
      readFileSync(join(dir, path), "utf8"),
      rendered("server/rate-limit", path),
    );
    assert.equal(existsSync(join(dir, path + ".new")), false);
  });

  for (let refresh of [false, true]) {
    for (let edited of [false, true]) {
      test(`${host}: ${refresh ? "refresh" : "add"} migrates the rate-limit switch with edited=${edited}`, async (t) => {
        let database = host === "github" ? "mongo" : "postgres";
        let dir = fixture(t, refresh ? host : "none", ["--db", database]);
        let paths: [string, string][] = [
          [`db/${database}`, "apps/server/src/utils/env.ts"],
          ["server/rate-limit", "apps/server/src/middleware/rate-limit.ts"],
        ];
        let originals = new Map<string, string>();
        for (let [fragment, path] of paths) {
          let content = rendered(fragment, path)
            .replace(/^.*RATE_LIMIT_ENABLED:.*\n/m, "")
            .replace(/^ \* Set RATE_LIMIT_ENABLED=false.*\n/m, "")
            .replace(" || !$env.RATE_LIMIT_ENABLED", "");
          content = await format(content, { filepath: path, tabWidth: 4 });
          if (edited) content += '\nexport const PROJECT_SETTING = "kept";\n';
          originals.set(path, content);
          writeFileSync(join(dir, path), content);
        }
        let testPath = "apps/server/src/middleware/rate-limit.test.ts";
        rmSync(join(dir, testPath), { force: true });
        let envTestPath = "apps/server/src/utils/env.test.ts";
        rmSync(join(dir, envTestPath), { force: true });
        record(dir);
        let result = add(dir, `ci-${host}`, refresh ? ["--refresh"] : []);
        assert.equal(result.status, 0, result.output);
        for (let [fragment, path] of paths) {
          assert.equal(
            readFileSync(join(dir, path), "utf8"),
            edited ? originals.get(path) : rendered(fragment, path),
            path,
          );
          assert.equal(existsSync(join(dir, path + ".new")), edited, path);
          if (edited) {
            assert.equal(
              readFileSync(join(dir, path + ".new"), "utf8"),
              rendered(fragment, path),
              path,
            );
          }
        }
        assert.equal(
          readFileSync(join(dir, testPath), "utf8"),
          rendered("server/rate-limit", testPath),
        );
        assert.equal(
          readFileSync(join(dir, envTestPath), "utf8"),
          rendered("base", envTestPath),
        );
        assert.equal(
          result.output.includes("Merge before your first gate run or release"),
          edited,
          result.output,
        );
      });
    }
  }

  test(`${host}: refresh preserves project-owned files and replaces other fragment files`, (t) => {
    let dir = fixture(t, host);
    let owned = [
      "scripts/release/deploy.sh",
      "scripts/release/config.sh",
      "scripts/release/environments/production.env",
      "scripts/release/environments/dev.env",
    ];
    let refreshed = [
      "scripts/release/promote.sh",
      "scripts/release/host.sh",
      host === "github" ? ".github/workflows/release.yml" : ".gitlab-ci.yml",
    ];
    for (let path of [...owned, ...refreshed]) {
      writeFileSync(join(dir, path), "PROJECT_OWNED=true\n");
    }
    record(dir);
    let result = add(dir, `ci-${host}`, ["--refresh"]);
    assert.equal(result.status, 0, result.output);
    for (let path of owned) {
      assert.equal(
        readFileSync(join(dir, path), "utf8"),
        "PROJECT_OWNED=true\n",
        path,
      );
    }
    for (let path of refreshed) {
      let fragment =
        path === "scripts/release/promote.sh" ? "ci/common" : `ci/${host}`;
      assert.equal(
        readFileSync(join(dir, path), "utf8"),
        rendered(fragment, path),
        path,
      );
    }
    assert.deepEqual(
      files(dir).filter((path) => path.endsWith(".new")),
      [],
    );
  });

  test(`${host}: an existing host refuses both repeat and switch even with force`, (t) => {
    let dir = fixture(t, host);
    record(dir);
    for (let requested of ["github", "gitlab"]) {
      let result = add(dir, `ci-${requested}`, ["--force"]);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /A CI host is already set/);
      assertHostFiles(dir, host);
    }
  });

  for (let refresh of [false, true]) {
    test(`${host}: force cannot bypass the clean-tree check for ${refresh ? "refresh" : "add"}`, (t) => {
      let dir = fixture(t, refresh ? host : "none");
      record(dir);
      writeFileSync(join(dir, "project-change.txt"), "uncommitted\n");
      let result = add(dir, `ci-${host}`, [
        "--force",
        ...(refresh ? ["--refresh"] : []),
      ]);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /Working tree is not clean/);
      assert.match(result.output, /--force cannot bypass/);
      assert.equal(
        JSON.parse(readFileSync(join(dir, "pimasi.json"), "utf8")).ci,
        refresh ? host : "none",
      );
    });
  }
}

for (let database of ["mongo", "postgres"]) {
  for (let withCi of [false, true]) {
    test(`${database}: adding rate limiting${withCi ? " with CI" : " alone"} upgrades the old environment`, (t) => {
      let dir = fixture(t, "none", ["--db", database, "--no-rate-limit"]);
      let envPath = "apps/server/src/utils/env.ts";
      writeFileSync(
        join(dir, envPath),
        rendered(`db/${database}`, envPath).replace(
          /^.*RATE_LIMIT_ENABLED:.*\n/m,
          "",
        ),
      );
      record(dir);
      let result = add(dir, "rate-limit", withCi ? ["ci-gitlab"] : []);
      assert.equal(result.status, 0, result.output);
      assert.equal(
        readFileSync(join(dir, envPath), "utf8"),
        rendered(`db/${database}`, envPath),
      );
      assert.equal(
        readFileSync(
          join(dir, "apps/server/src/middleware/rate-limit.ts"),
          "utf8",
        ),
        rendered(
          "server/rate-limit",
          "apps/server/src/middleware/rate-limit.ts",
        ),
      );
      assert.deepEqual(
        files(dir).filter((path) => path.endsWith(".new")),
        [],
      );
    });
  }
}

for (let formatted of [false, true]) {
  test(`CI upgrades pristine 0.2.0 prerequisites: formatted=${formatted}`, async (t) => {
    let dir = fixture(t, "none", ["--frontend", "nextjs", "--db", "postgres"]);
    let paths: [string, string][] = [
      ["base", "Dockerfile.server"],
      ["base", "apps/server/process.config.js"],
      ["base", "apps/server/src/handlers/ping.route.ts"],
      ["base", "apps/server/src/handlers/ping.test.ts"],
      ["base", "apps/shared/lib/src/schemas/api/ping-response.schema.ts"],
      ["db/postgres", "apps/server/src/utils/env.ts"],
      ["frontend/nextjs", "Dockerfile.web"],
      ["frontend/nextjs", "apps/web/tsconfig.json"],
    ];
    for (let [fragment, path] of paths) {
      let content = rendered(`legacy/0.2.0/${fragment}`, path);
      if (formatted && /\.(js|ts|json)$/.test(path)) {
        content = await format(content, { filepath: path, tabWidth: 4 });
      }
      writeFileSync(join(dir, path), content);
    }
    record(dir);
    let result = add(dir, "ci-github");
    assert.equal(result.status, 0, result.output);
    for (let [fragment, path] of paths) {
      assert.equal(
        readFileSync(join(dir, path), "utf8"),
        rendered(fragment, path),
        path,
      );
    }
    assert.deepEqual(
      files(dir).filter((path) => path.endsWith(".new")),
      [],
    );
  });

  test(`workers replace pristine 0.2.0 seam files: formatted=${formatted}`, async (t) => {
    let dir = fixture(t);
    let paths = [
      "apps/server/process.config.js",
      "apps/server/src/handlers/email/dispatch.ts",
    ];
    for (let path of paths) {
      let content = rendered("legacy/0.2.0/base", path);
      if (formatted) {
        content = await format(content, { filepath: path, tabWidth: 4 });
      }
      writeFileSync(join(dir, path), content);
    }
    record(dir);
    let result = add(dir, "workers");
    assert.equal(result.status, 0, result.output);
    for (let path of paths) {
      assert.equal(
        readFileSync(join(dir, path), "utf8"),
        rendered("server/workers", path),
        path,
      );
    }
    assert.deepEqual(
      files(dir).filter((path) => path.endsWith(".new")),
      [],
    );
  });
}

const QUESTION = "Only Maintainers can release?";

function maintainersOnly(dir: string) {
  let path = join(dir, "scripts/release/config.sh");
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8").match(
    /^RELEASE_MAINTAINERS_ONLY=(.*)$/m,
  )?.[1];
}

function tree(dir: string) {
  return Object.fromEntries(
    files(dir)
      .sort()
      .map((path) => [path, readFileSync(join(dir, path), "utf8")]),
  );
}

function scaffoldArgs(dir: string, host: string) {
  return [
    CLI,
    NAME,
    "--frontend",
    "tanstack",
    "--db",
    "mongo",
    "--design",
    "shadcn",
    "--ci",
    host,
    "--no-cordova",
    "--no-workers",
    "--no-cache",
    "--no-rate-limit",
    "--no-websockets",
    "--no-install",
    "--dir",
    dir,
  ];
}

async function prompted(
  t: TestContext,
  dir: string,
  args: string[],
  answer: string,
) {
  let support = mkdtempSync(join(tmpdir(), "g1-ci-tty-"));
  t.after(() => rmSync(support, { recursive: true, force: true }));
  let preload = join(support, "tty.mjs");
  writeFileSync(
    preload,
    'Object.defineProperty(process.stdin, "isTTY", { value: true });\nprocess.stdin.setRawMode = () => process.stdin;\n',
  );
  let child = spawn(process.execPath, ["--import", preload, ...args], {
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  let asked = false;
  let timer = setTimeout(() => child.kill("SIGKILL"), 30000);
  child.stdin.on("error", () => {});
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (!asked && output.includes(QUESTION)) {
      asked = true;
      setTimeout(() => child.stdin.write(answer), 30);
    }
    if (output.includes("Done.")) child.stdin.end();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  let status = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  clearTimeout(timer);
  return { status, output, asked };
}

for (let host of ["github", "gitlab"]) {
  for (let [args, expected] of [
    [[], "true"],
    [["--maintainers-only"], "true"],
    [["--no-maintainers-only"], "false"],
  ] as [string[], string][]) {
    test(`${host}: ${args[0] ?? "the --yes default"} writes RELEASE_MAINTAINERS_ONLY=${expected} and adding equals generating`, (t) => {
      let generated = fixture(t, host, args);
      let added = fixture(t);
      record(added);
      let result = add(added, `ci-${host}`, args);
      assert.equal(result.status, 0, result.output);
      assert.equal(maintainersOnly(generated), expected);
      assert.equal(
        JSON.parse(readFileSync(join(added, "pimasi.json"), "utf8")).rateLimit,
        true,
      );
      assert.equal(
        readFileSync(
          join(added, "apps/server/src/middleware/rate-limit.ts"),
          "utf8",
        ),
        rendered(
          "server/rate-limit",
          "apps/server/src/middleware/rate-limit.ts",
        ),
      );
      assert.deepEqual(tree(added), tree(generated));
    });
  }
}

for (let [host, answer, expected] of [
  ["github", "\r", "true"],
  ["gitlab", "n\r", "false"],
]) {
  test(`${host}: the wizard asks "${QUESTION}" and writes ${expected} for ${answer === "\r" ? "the default" : "no"}`, async (t) => {
    let dir = mkdtempSync(join(tmpdir(), "g1-ci-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    let result = await prompted(t, dir, scaffoldArgs(dir, host), answer);
    assert.equal(result.status, 0, result.output);
    assert.equal(result.asked, true, result.output);
    assert.equal(maintainersOnly(dir), expected);
  });

  test(`${host}: add ci-${host} asks "${QUESTION}" and writes ${expected} for ${answer === "\r" ? "the default" : "no"}`, async (t) => {
    let dir = fixture(t);
    record(dir);
    let result = await prompted(
      t,
      dir,
      [CLI, "add", `ci-${host}`, "--no-install"],
      answer,
    );
    assert.equal(result.status, 0, result.output);
    assert.equal(result.asked, true, result.output);
    assert.equal(maintainersOnly(dir), expected);
  });
}

for (let host of ["github", "gitlab"]) {
  for (let stdin of ["closed", "open"]) {
    test(`${host}: add ci-${host} with stdin ${stdin} and no terminal takes the default and says so`, async (t) => {
      let dir = fixture(t);
      record(dir);
      let child = spawn(
        process.execPath,
        [CLI, "add", `ci-${host}`, "--no-install"],
        { cwd: dir, stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "";
      let timer = setTimeout(() => child.kill("SIGKILL"), 30000);
      child.stdin.on("error", () => {});
      if (stdin === "closed") child.stdin.end();
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      let status = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
      clearTimeout(timer);
      child.stdin.destroy();
      assert.equal(status, 0, output);
      assert.match(
        output,
        /No terminal to ask "Only Maintainers can release\?", so add uses the default, yes; pass --maintainers-only or --no-maintainers-only to choose\./,
      );
      assert.equal(maintainersOnly(dir), "true");
      assertHostFiles(dir, host);
    });
  }
}

test(`the wizard does not ask "${QUESTION}" without a CI host`, async (t) => {
  let dir = mkdtempSync(join(tmpdir(), "g1-ci-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let result = await prompted(t, dir, scaffoldArgs(dir, "none"), "\r");
  assert.equal(result.status, 0, result.output);
  assert.equal(result.asked, false, result.output);
  assert.equal(maintainersOnly(dir), undefined);
});

test("the Maintainer-only flags need a CI host when scaffolding", (t) => {
  let dir = mkdtempSync(join(tmpdir(), "g1-ci-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (let flag of ["--maintainers-only", "--no-maintainers-only"]) {
    let result = command(dir, process.execPath, [
      CLI,
      NAME,
      "--yes",
      "--ci",
      "none",
      "--no-install",
      "--dir",
      dir,
      flag,
    ]);
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /--maintainers-only and --no-maintainers-only need --ci github or --ci gitlab/,
    );
    assert.deepEqual(readdirSync(dir), []);
  }
});

test("the Maintainer-only flags apply only when adding a CI host", (t) => {
  let lean = fixture(t);
  record(lean);
  let result = add(lean, "workers", ["--maintainers-only"]);
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /--maintainers-only and --no-maintainers-only apply only when adding ci-github or ci-gitlab/,
  );
  assert.equal(
    JSON.parse(readFileSync(join(lean, "pimasi.json"), "utf8")).workers,
    false,
  );
  let hosted = fixture(t, "github");
  record(hosted);
  result = add(hosted, "ci-github", ["--refresh", "--no-maintainers-only"]);
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /--maintainers-only and --no-maintainers-only apply only when adding ci-github or ci-gitlab/,
  );
  assert.equal(maintainersOnly(hosted), "true");
});
