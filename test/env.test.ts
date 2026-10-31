import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const PRODUCTION = "RELEASE_PUBLISH=true\nRELEASE_HEALTH_URL=\n";

for (let ci of ["github", "gitlab"]) {
  test(`${ci}: --after creates a follower without changing its prerequisite`, (t) => {
    let project = fixture(t, PRODUCTION, ci);
    let result = run(
      project.dir,
      "add",
      "dev",
      "--after",
      "production",
      "--yes",
    );
    assert.equal(result.status, 0, result.output);
    assert.equal(project.read("production"), PRODUCTION);
    assert.equal(
      project.read("dev"),
      PRODUCTION.replace("true", "false") + "RELEASE_AFTER=production\n",
    );
    assert.match(result.output, /dev follows production/);
  });

  test(`${ci}: refuses a cycle already present in environment files`, (t) => {
    let project = fixture(t, PRODUCTION + "RELEASE_AFTER=uat\n", ci);
    let uat = "RELEASE_PUBLISH=false\nRELEASE_AFTER=production\n";
    writeFileSync(join(project.environments, "uat.env"), uat);
    for (let args of [
      ["list"],
      ["add", "dev", "--yes"],
      ["remove", "uat", "--yes"],
    ]) {
      let result = run(project.dir, ...args);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /Environment relation cycle:/);
      assert.equal(
        project.read("production"),
        PRODUCTION + "RELEASE_AFTER=uat\n",
      );
      assert.equal(project.read("uat"), uat);
      assert.deepEqual(readdirSync(project.environments), [
        "production.env",
        "uat.env",
      ]);
    }
  });

  test(`${ci}: --publish creates an independent environment that creates versions`, (t) => {
    let project = fixture(t, PRODUCTION, ci);
    let result = run(project.dir, "add", "uat", "--publish", "--yes");
    assert.equal(result.status, 0, result.output);
    assert.equal(project.read("uat"), PRODUCTION);
    assert.equal(project.read("production"), PRODUCTION);
    assert.match(result.output, /uat is independent/);
    let listing = run(project.dir, "list");
    assert.equal(listing.status, 0, listing.output);
    assert.match(listing.output, /uat\s+no\s+yes\s+independent/);
  });

  test(`${ci}: accepts a 32-character environment name`, (t) => {
    let project = fixture(t, PRODUCTION, ci);
    let name = "d".repeat(32);
    let result = run(project.dir, "add", name, "--yes");
    assert.equal(result.status, 0, result.output);
    assert.equal(project.read(name), PRODUCTION.replace("true", "false"));
  });

  test(`${ci}: refuses a 33-character environment name before writing`, (t) => {
    let project = fixture(t, PRODUCTION, ci);
    let result = run(project.dir, "add", "d".repeat(33), "--yes");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /at most 32 characters/);
    assert.deepEqual(readdirSync(project.environments), ["production.env"]);
    assert.equal(project.read("production"), PRODUCTION);
  });
}

for (let ci of ["none", undefined]) {
  test(`refuses environment commands with no CI host: ${ci ?? "missing key"}`, (t) => {
    let project = fixture(t);
    let manifest = JSON.stringify({ ci });
    writeFileSync(join(project.dir, "pimasi.json"), manifest);
    for (let args of [
      ["list"],
      ["add", "dev", "--yes"],
      ["remove", "dev", "--yes"],
    ]) {
      let result = run(project.dir, ...args);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /add ci-github.*add ci-gitlab/);
      assert.match(result.output, /environments require a CI host/);
      assert.deepEqual(readdirSync(project.environments), ["production.env"]);
      assert.equal(
        readFileSync(join(project.dir, "pimasi.json"), "utf8"),
        manifest,
      );
      assert.equal(project.read("production"), PRODUCTION);
    }
  });
}

function fixture(t: TestContext, content = PRODUCTION, ci = "github") {
  let dir = mkdtempSync(join(tmpdir(), "env-test-"));
  let environments = join(dir, "scripts/release/environments");
  mkdirSync(environments, { recursive: true });
  writeFileSync(join(dir, "pimasi.json"), JSON.stringify({ ci }));
  writeFileSync(join(environments, "production.env"), content);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return {
    dir,
    environments,
    read: (name: string) =>
      readFileSync(join(environments, `${name}.env`), "utf8"),
  };
}

function run(dir: string, ...args: string[]) {
  let result = spawnSync(process.execPath, [CLI, "env", ...args], {
    cwd: dir,
    encoding: "utf8",
    timeout: 5000,
    env: commandEnvironment(dir),
  });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

function commandEnvironment(dir: string) {
  return {
    ...process.env,
    ...(existsSync(join(dir, "bin")) ? { PATH: join(dir, "bin") } : {}),
  };
}

async function runPrompt(
  dir: string,
  args: string[],
  edit: () => void,
  confirmed = true,
  versionAnswer = "\r",
) {
  let preload = join(dir, "tty.mjs");
  writeFileSync(
    preload,
    'Object.defineProperty(process.stdin, "isTTY", { value: true });\nprocess.stdin.setRawMode = () => process.stdin;\n',
  );
  let child = spawn(
    process.execPath,
    ["--import", preload, CLI, "env", ...args],
    {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      env: commandEnvironment(dir),
    },
  );
  let output = "";
  let edited = false;
  let answered = new Set<string>();
  let timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  child.stdin.on("error", () => {});
  child.stdout.on("data", (chunk) => {
    output += chunk;
    for (let prompt of [
      "Environment name?",
      "How does this environment relate",
      "Before which environment?",
      "Deploy automatically after a merge to main?",
      "Create a version when deployed here?",
      "Remove environment",
    ]) {
      if (!output.includes(prompt) || answered.has(prompt)) continue;
      answered.add(prompt);
      if (!edited) {
        edit();
        edited = true;
      }
      setTimeout(
        () =>
          child.stdin.write(
            prompt.startsWith("Create a version")
              ? versionAnswer
              : prompt === "Remove environment" ||
                  prompt.startsWith("Deploy automatically")
                ? confirmed
                  ? "y\r"
                  : "n\r"
                : "\r",
          ),
        30,
      );
    }
    if (output.includes("Done.") || output.includes("Cancelled.")) {
      child.stdin.end();
    }
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  let status = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  clearTimeout(timer);
  assert.equal(edited, true, output);
  return { status, output };
}

for (let ci of ["github", "gitlab"]) {
  test(`${ci}: independent environments, insertion and removal`, (t) => {
    let project = fixture(t, PRODUCTION, ci);
    let manifest = readFileSync(join(project.dir, "pimasi.json"), "utf8");
    let listing = run(project.dir, "list");
    assert.equal(listing.status, 0, listing.output);
    assert.match(
      listing.output,
      /production\s+yes\s+yes\s+independent\s+unset/,
    );
    for (let args of [
      ["add", "uat", "--before", "production", "--yes"],
      ["add", "dev", "--yes"],
      ["add", "qa", "--before", "production", "--yes"],
    ]) {
      let result = run(project.dir, ...args);
      assert.equal(result.status, 0, result.output);
      assert.match(
        result.output,
        ci === "github" ? /gh workflow run/ : /glab ci run/,
      );
    }
    assert.equal(project.read("uat"), PRODUCTION.replace("true", "false"));
    assert.equal(project.read("dev"), PRODUCTION.replace("true", "false"));
    assert.equal(
      project.read("qa"),
      PRODUCTION.replace("true", "false") + "RELEASE_AFTER=uat\n",
    );
    assert.equal(project.read("production"), PRODUCTION + "RELEASE_AFTER=qa\n");
    assert.equal(run(project.dir, "remove", "qa", "--yes").status, 0);
    assert.equal(
      project.read("production"),
      PRODUCTION + "RELEASE_AFTER=uat\n",
    );
    assert.equal(run(project.dir, "remove", "uat", "--yes").status, 0);
    assert.equal(project.read("production"), PRODUCTION);
    assert.equal(
      readFileSync(join(project.dir, "pimasi.json"), "utf8"),
      manifest,
    );
    for (let args of [
      ["add", "dev", "--yes"],
      ["add", "production", "--yes"],
      ["remove", "production", "--yes"],
      ["add", "Bad", "--yes"],
      ["add", "qa", "--after", "missing", "--yes"],
      ["add", "qa", "--after", "qa", "--yes"],
    ]) {
      assert.equal(run(project.dir, ...args).status, 1, args.join(" "));
    }
  });
}

for (let quote of ["'", '"']) {
  test(`preserves unknown multiline ${quote} values and top-level keys`, (t) => {
    let custom = `CUSTOM_TEMPLATE=${quote}header\nRELEASE_AFTER=\nRELEASE_PUBLISH=false\nfooter${quote}\n`;
    let original = PRODUCTION + custom;
    let project = fixture(t, original);
    let result = run(
      project.dir,
      "add",
      "uat",
      "--before",
      "production",
      "--yes",
    );
    assert.equal(result.status, 0, result.output);
    assert.equal(project.read("production"), original + "RELEASE_AFTER=uat\n");
    assert.equal(
      project.read("uat"),
      PRODUCTION.replace("true", "false") + custom,
    );
    assert.equal(run(project.dir, "remove", "uat", "--yes").status, 0);
    assert.equal(project.read("production"), original);
  });
}

test("preserves CRLF, comments, exported keys and unknown key order", (t) => {
  let original =
    "# a user's comment\r\nCUSTOM='one'\r\nexport RELEASE_PUBLISH='true' # publish\r\nRELEASE_HEALTH_URL=\"https://api.example.com\" # health\r\nOTHER=last\r\n";
  let project = fixture(t, original);
  let result = run(
    project.dir,
    "add",
    "uat",
    "--before",
    "production",
    "--yes",
  );
  assert.equal(result.status, 0, result.output);
  assert.equal(project.read("production"), original + "RELEASE_AFTER=uat\r\n");
  assert.equal(
    project.read("uat"),
    original
      .replace("RELEASE_PUBLISH='true'", "RELEASE_PUBLISH=false")
      .replace(
        'RELEASE_HEALTH_URL="https://api.example.com"',
        "RELEASE_HEALTH_URL=",
      ),
  );
});

for (let syntax of [
  "if true; then\nRELEASE_AFTER=\nfi\n",
  "CUSTOM=$(printf value)\n",
  "cat <<'END'\nRELEASE_AFTER=\nEND\n",
  "CUSTOM='unterminated\n",
]) {
  test(`refuses unsupported shell syntax without changes: ${syntax.split("\n")[0]}`, (t) => {
    let original = PRODUCTION + syntax;
    let project = fixture(t, original);
    let result = run(
      project.dir,
      "add",
      "uat",
      "--before",
      "production",
      "--yes",
    );
    assert.equal(result.status, 1, result.output);
    assert.equal(project.read("production"), original);
    assert.deepEqual(readdirSync(project.environments), ["production.env"]);
  });
}

for (let change of ["edit", "add", "delete"]) {
  test(`refuses environment ${change} while add prompts are open`, async (t) => {
    let project = fixture(t);
    let productionPath = join(project.environments, "production.env");
    let result = await runPrompt(
      project.dir,
      ["add", "uat", "--before", "production"],
      () => {
        if (change === "edit")
          writeFileSync(productionPath, PRODUCTION + "CUSTOM=edited\n");
        if (change === "add")
          writeFileSync(
            join(project.environments, "dev.env"),
            "RELEASE_PUBLISH=false\n",
          );
        if (change === "delete") unlinkSync(productionPath);
      },
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /changed.*again/i);
    assert.equal(existsSync(join(project.environments, "uat.env")), false);
    if (change === "edit")
      assert.equal(project.read("production"), PRODUCTION + "CUSTOM=edited\n");
    if (change === "delete") assert.equal(existsSync(productionPath), false);
    if (change === "add")
      assert.equal(project.read("dev"), "RELEASE_PUBLISH=false\n");
  });
}

test("refuses edits to the removed environment while confirmation is open", async (t) => {
  let project = fixture(t, PRODUCTION + "RELEASE_AFTER=uat\n");
  let removedPath = join(project.environments, "uat.env");
  writeFileSync(removedPath, "RELEASE_PUBLISH=false\n");
  let result = await runPrompt(project.dir, ["remove", "uat"], () => {
    writeFileSync(removedPath, "RELEASE_PUBLISH=false\nCUSTOM=edited\n");
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /changed.*again/i);
  assert.equal(project.read("production"), PRODUCTION + "RELEASE_AFTER=uat\n");
  assert.equal(project.read("uat"), "RELEASE_PUBLISH=false\nCUSTOM=edited\n");
});

function hostFixture(
  t: TestContext,
  ci: string,
  initial: Record<string, unknown> = {},
) {
  let project = fixture(t, PRODUCTION, ci);
  let bin = join(project.dir, "bin");
  mkdirSync(bin);
  let statePath = join(project.dir, "host.json");
  let callsPath = join(project.dir, "calls.jsonl");
  let state = {
    environments: [{ id: 1, name: "production", state: "available" }],
    variables: [],
    ...initial,
  };
  writeFileSync(statePath, JSON.stringify(state));
  let executable = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const statePath = path.join(process.cwd(), "host.json");
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync("calls.jsonl", JSON.stringify({ tool, args }) + "\\n");
if (tool === "git") {
  if (state.noRemote) process.exit(1);
  process.stdout.write(state.remote || "git@${ci}.example:team/e1-app.git");
  process.exit(0);
}
if (state.signedOut || state.unreadable) {
  process.stderr.write("private-provider-error");
  process.exit(1);
}
const methodIndex = args.indexOf("--method");
const method = methodIndex < 0 ? "GET" : args[methodIndex + 1];
const endpoint = args[1];
const hostIndex = args.indexOf("--hostname");
if (hostIndex < 0 || args[hostIndex + 1] !== "${ci}.example") process.exit(3);
if (!endpoint.startsWith(tool === "gh" ? "repos/team/e1-app/" : "projects/team%2Fe1-app/")) process.exit(4);
if (method !== "GET" && state.refuseWrites) process.exit(1);
if (endpoint.endsWith("/stop") && method !== "POST") process.exit(9);
if (method === "GET") {
  const items = endpoint.includes("/variables") ? state.variables : state.environments;
  if (!args.includes("--paginate")) process.exit(5);
  if (tool === "gh") {
    if (!args.includes("--slurp")) process.exit(6);
    process.stdout.write(JSON.stringify([{ environments: items.slice(0, 1) }, { environments: items.slice(1) }]));
  } else {
    if (!args.includes("ndjson")) process.exit(7);
    process.stdout.write(items.map((item) => JSON.stringify(item)).join("\\n"));
  }
} else if (endpoint.includes("/variables/")) {
  const key = decodeURIComponent(endpoint.split("/variables/")[1].split("?")[0]);
  const query = new URLSearchParams(endpoint.split("?")[1]);
  const scope = query.get("filter[environment_scope]");
  if (method !== "DELETE" || scope !== "dev") process.exit(8);
  if (!state.variables.some((item) => item.key === key && item.environment_scope === scope)) process.exit(8);
  if (state.refuseVariableDelete) process.exit(1);
  state.variables = state.variables.filter((item) => item.key !== key || item.environment_scope !== scope);
} else if (endpoint.endsWith("/stop")) {
  if (!args.includes("force=true")) process.exit(9);
  const id = Number(endpoint.split("/").at(-2));
  state.environments.find((item) => item.id === id).state = "stopped";
} else if (method === "DELETE") {
  const identity = endpoint.split("/").at(-1);
  if (tool === "glab" && !state.environments.some((item) => item.id === Number(identity) && item.state === "stopped")) process.exit(11);
  state.environments = state.environments.filter((item) => tool === "gh" ? item.name !== identity : item.id !== Number(identity));
} else {
  const name = tool === "gh" ? endpoint.split("/").at(-1) : args.find((arg) => arg.startsWith("name="))?.slice(5);
  if (!name || (tool === "gh" ? method !== "PUT" : method !== "POST")) process.exit(10);
  state.environments.push({ id: 2, name, state: "available" });
}
fs.writeFileSync(statePath, JSON.stringify(state));
`;
  for (let tool of [
    "git",
    ...(initial.toolMissing ? [] : [ci === "github" ? "gh" : "glab"]),
  ]) {
    writeFileSync(join(bin, tool), executable);
    chmodSync(join(bin, tool), 0o755);
  }
  return {
    ...project,
    host: () => JSON.parse(readFileSync(statePath, "utf8")),
    calls: () =>
      existsSync(callsPath)
        ? readFileSync(callsPath, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        : [],
  };
}

for (let ci of ["github", "gitlab"]) {
  test(`${ci}: creates the host environment, on-merge setting and list status`, (t) => {
    let project = hostFixture(t, ci);
    let result = run(project.dir, "add", "dev", "--on-merge", "--yes");
    assert.equal(result.status, 0, result.output);
    assert.equal(
      project.read("dev"),
      "RELEASE_PUBLISH=false\nRELEASE_HEALTH_URL=\nRELEASE_ON_MERGE=true\n",
    );
    assert.equal(project.read("production"), PRODUCTION);
    assert.equal(project.host().environments.at(-1).name, "dev");
    assert.match(result.output, /Created host environment "dev"/);
    writeFileSync(
      join(project.environments, "uat.env"),
      "RELEASE_PUBLISH=false\n",
    );
    let listing = run(project.dir, "list");
    assert.equal(listing.status, 0, listing.output);
    assert.match(listing.output, /On merge\s+Host/);
    assert.match(
      listing.output,
      /dev\s+no\s+no\s+independent\s+unset\s+yes\s+exists/,
    );
    assert.match(
      listing.output,
      /uat\s+no\s+no\s+independent\s+unset\s+no\s+not yet created/,
    );
    let removed = run(project.dir, "remove", "dev", "--yes");
    assert.equal(removed.status, 0, removed.output);
    assert.equal(existsSync(join(project.environments, "dev.env")), false);
    assert.deepEqual(
      project
        .host()
        .environments.map((environment: { name: string }) => environment.name),
      ["production"],
    );
  });

  test(`${ci}: existing host environment is preserved`, (t) => {
    let project = hostFixture(t, ci, {
      environments: [{ id: 2, name: "dev", protection: "kept" }],
    });
    let result = run(project.dir, "add", "dev", "--yes");
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Host environment "dev" already exists/);
    assert.deepEqual(project.host().environments, [
      { id: 2, name: "dev", protection: "kept" },
    ]);
    assert.equal(
      project
        .calls()
        .some(
          (call) => call.args.includes("PUT") || call.args.includes("POST"),
        ),
      false,
    );
  });

  for (let failure of [
    "toolMissing",
    "signedOut",
    "noRemote",
    "refuseWrites",
  ]) {
    test(`${ci}: ${failure} defers host creation and leaves local add successful`, (t) => {
      let project = hostFixture(t, ci, { [failure]: true });
      let result = run(project.dir, "add", "dev", "--yes");
      assert.equal(result.status, 0, result.output);
      assert.equal(project.read("dev"), PRODUCTION.replace("true", "false"));
      assert.match(result.output, /first promotion will create it/);
      assert.doesNotMatch(result.output, /private-provider-error/);
      if (failure !== "refuseWrites") {
        assert.match(run(project.dir, "list").output, /production.*unknown/);
      }
      let removed = run(project.dir, "remove", "dev", "--yes");
      assert.equal(removed.status, 0, removed.output);
      assert.equal(existsSync(join(project.environments, "dev.env")), false);
      if (failure !== "refuseWrites")
        assert.match(removed.output, /host environment.*left in place/i);
    });
  }

  test(`${ci}: confirmation deletes host environment and exact-scope secrets`, async (t) => {
    let project = hostFixture(t, ci, {
      environments: [{ id: 2, name: "dev", state: "available" }],
      variables: [
        {
          key: "TOKEN",
          value: "secret-never-printed",
          environment_scope: "dev",
        },
        { key: "TOKEN", value: "global-never-printed", environment_scope: "*" },
        {
          key: "TOKEN",
          value: "wildcard-never-printed",
          environment_scope: "d*",
        },
      ],
    });
    writeFileSync(
      join(project.environments, "dev.env"),
      "RELEASE_PUBLISH=false\n",
    );
    let result = await runPrompt(project.dir, ["remove", "dev"], () => {});
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /host-side secrets/);
    assert.doesNotMatch(result.output, /never-printed/);
    assert.equal(existsSync(join(project.environments, "dev.env")), false);
    assert.deepEqual(project.host().environments, []);
    if (ci === "gitlab")
      assert.deepEqual(
        project
          .host()
          .variables.map(
            (item: { environment_scope: string }) => item.environment_scope,
          ),
        ["*", "d*"],
      );
  });

  test(`${ci}: declined deletion leaves host and files intact`, async (t) => {
    let project = hostFixture(t, ci);
    writeFileSync(
      join(project.environments, "dev.env"),
      "RELEASE_PUBLISH=false\n",
    );
    let before = project.host();
    let result = await runPrompt(
      project.dir,
      ["remove", "dev"],
      () => {},
      false,
    );
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /host-side secrets/);
    assert.equal(project.read("dev"), "RELEASE_PUBLISH=false\n");
    assert.deepEqual(project.host(), before);
    assert.deepEqual(project.calls(), []);
  });

  test(`${ci}: --keep-host never contacts the host`, (t) => {
    let project = hostFixture(t, ci);
    writeFileSync(
      join(project.environments, "dev.env"),
      "RELEASE_PUBLISH=false\n",
    );
    let result = run(project.dir, "remove", "dev", "--keep-host", "--yes");
    assert.equal(result.status, 0, result.output);
    assert.equal(existsSync(join(project.environments, "dev.env")), false);
    assert.match(result.output, /host environment.*left in place/i);
    assert.deepEqual(project.calls(), []);
  });

  test(`${ci}: non-interactive deletion needs --yes or --keep-host`, (t) => {
    let project = hostFixture(t, ci);
    writeFileSync(
      join(project.environments, "dev.env"),
      "RELEASE_PUBLISH=false\n",
    );
    let result = run(project.dir, "remove", "dev");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /--yes.*--keep-host/);
    assert.equal(project.read("dev"), "RELEASE_PUBLISH=false\n");
    assert.deepEqual(project.calls(), []);
  });
}

test("the interactive add offers deployment after a merge", async (t) => {
  let project = hostFixture(t, "github");
  let result = await runPrompt(project.dir, ["add", "dev"], () => {});
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Deploy automatically after a merge to main/);
  assert.match(project.read("dev"), /RELEASE_ON_MERGE=true/);
});

test("the interactive add asks whether to create versions, defaulting to no", async (t) => {
  let project = hostFixture(t, "github");
  let result = await runPrompt(project.dir, ["add", "dev"], () => {});
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Create a version when deployed here\?/);
  assert.match(project.read("dev"), /^RELEASE_PUBLISH=false$/m);
});

test("answering yes to the version question writes RELEASE_PUBLISH=true", async (t) => {
  let project = hostFixture(t, "github");
  let result = await runPrompt(
    project.dir,
    ["add", "uat"],
    () => {},
    false,
    "y\r",
  );
  assert.equal(result.status, 0, result.output);
  assert.equal(project.read("uat"), PRODUCTION);
  assert.equal(project.read("production"), PRODUCTION);
});

test("--publish preselects yes for the version question", async (t) => {
  let project = hostFixture(t, "github");
  let result = await runPrompt(
    project.dir,
    ["add", "uat", "--publish"],
    () => {},
    false,
  );
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Create a version when deployed here\?/);
  assert.match(project.read("uat"), /^RELEASE_PUBLISH=true$/m);
});

test("on-merge configuration is opt-in when production enables it", (t) => {
  let project = fixture(t, PRODUCTION + "RELEASE_ON_MERGE=true # retained\n");
  let result = run(project.dir, "add", "dev", "--yes");
  assert.equal(result.status, 0, result.output);
  assert.equal(
    project.read("dev"),
    PRODUCTION.replace("true", "false") + "# retained\n",
  );
  assert.equal(
    project.read("production"),
    PRODUCTION + "RELEASE_ON_MERGE=true # retained\n",
  );
});

test("invalid on-merge values and misplaced flags are refused before writes", (t) => {
  let project = fixture(t, PRODUCTION + "RELEASE_ON_MERGE=perhaps\n");
  assert.equal(run(project.dir, "add", "dev", "--yes").status, 1);
  assert.deepEqual(readdirSync(project.environments), ["production.env"]);
  writeFileSync(join(project.environments, "production.env"), PRODUCTION);
  for (let args of [
    ["list", "--on-merge"],
    ["list", "--keep-host"],
    ["list", "--publish"],
    ["add", "dev", "--keep-host", "--yes"],
    ["remove", "dev", "--on-merge", "--yes"],
    ["remove", "dev", "--publish", "--yes"],
  ]) {
    assert.equal(run(project.dir, ...args).status, 1, args.join(" "));
  }
  assert.match(
    run(project.dir, "remove", "dev", "--publish", "--yes").output,
    /--publish is only valid with pimasi env add\./,
  );
});

test("GitLab reports a partial host removal without printing secret values", (t) => {
  let project = hostFixture(t, "gitlab", {
    environments: [{ id: 2, name: "dev", state: "available" }],
    variables: [
      { key: "TOKEN", value: "secret-never-printed", environment_scope: "dev" },
    ],
    refuseVariableDelete: true,
  });
  writeFileSync(
    join(project.environments, "dev.env"),
    "RELEASE_PUBLISH=false\n",
  );
  let result = run(project.dir, "remove", "dev", "--yes");
  assert.equal(result.status, 0, result.output);
  assert.equal(existsSync(join(project.environments, "dev.env")), false);
  assert.match(result.output, /host environment.*left in place.*partly/i);
  assert.doesNotMatch(result.output, /secret-never-printed/);
});

test("GitLab removal force-stops an active environment before deletion", (t) => {
  let project = hostFixture(t, "gitlab", {
    environments: [{ id: 2, name: "dev", state: "available" }],
  });
  writeFileSync(
    join(project.environments, "dev.env"),
    "RELEASE_PUBLISH=false\n",
  );
  let result = run(project.dir, "remove", "dev", "--yes");
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Deleted host environment "dev"/);
  let writes = project
    .calls()
    .filter((call: { tool: string; args: string[] }) => {
      return (
        call.tool === "glab" &&
        call.args[call.args.indexOf("--method") + 1] !== "GET"
      );
    });
  assert.deepEqual(
    writes.map((call: { args: string[] }) => {
      return {
        endpoint: call.args[1],
        method: call.args[call.args.indexOf("--method") + 1],
        fields: call.args.slice(call.args.indexOf("--method") + 2),
      };
    }),
    [
      {
        endpoint: "projects/team%2Fe1-app/environments/2/stop",
        method: "POST",
        fields: ["--field", "force=true"],
      },
      {
        endpoint: "projects/team%2Fe1-app/environments/2",
        method: "DELETE",
        fields: [],
      },
    ],
  );
  assert.deepEqual(project.host().environments, []);
});

test("GitLab removal requests each exact-scope variable only once", (t) => {
  let retained = [
    { key: "GLOBAL_TOKEN", environment_scope: "*" },
    { key: "WILDCARD_TOKEN", environment_scope: "d*" },
    { key: "TOKEN", environment_scope: "*" },
    { key: "UAT_TOKEN", environment_scope: "uat" },
  ];
  let project = hostFixture(t, "gitlab", {
    environments: [{ id: 2, name: "dev", state: "available" }],
    variables: [...retained, { key: "TOKEN", environment_scope: "dev" }],
  });
  writeFileSync(
    join(project.environments, "dev.env"),
    "RELEASE_PUBLISH=false\n",
  );
  let result = run(project.dir, "remove", "dev", "--yes");
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Deleted host environment "dev"/);
  let deletes = project
    .calls()
    .filter((call: { tool: string; args: string[] }) => {
      return (
        call.tool === "glab" &&
        call.args.includes("DELETE") &&
        call.args[1].includes("/variables/")
      );
    });
  assert.deepEqual(
    deletes.map((call: { args: string[] }) => call.args[1]),
    [
      "projects/team%2Fe1-app/variables/TOKEN?filter%5Benvironment_scope%5D=dev",
    ],
  );
  assert.deepEqual(project.host().variables, retained);
  assert.deepEqual(project.host().environments, []);
});

function fakeGitLabRequest(dir: string, endpoint: string, method: string) {
  return spawnSync(
    join(dir, "bin/glab"),
    [
      "api",
      `projects/team%2Fe1-app/${endpoint}`,
      "--hostname",
      "gitlab.example",
      "--method",
      method,
      "--field",
      "force=true",
      "--paginate",
      "--output",
      "ndjson",
    ],
    { cwd: dir, encoding: "utf8", env: commandEnvironment(dir) },
  );
}

test("fake GitLab rejects deletion of an active environment", (t) => {
  let project = hostFixture(t, "gitlab", {
    environments: [{ id: 2, name: "dev", state: "available" }],
  });
  let before = project.host();
  let result = fakeGitLabRequest(project.dir, "environments/2", "DELETE");
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.deepEqual(project.host(), before);
});

for (let method of ["GET", "PUT", "DELETE"]) {
  test(`fake GitLab refuses ${method} as a stop request`, (t) => {
    let project = hostFixture(t, "gitlab", {
      environments: [{ id: 2, name: "dev", state: "available" }],
    });
    let before = project.host();
    let result = fakeGitLabRequest(project.dir, "environments/2/stop", method);
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.deepEqual(project.host(), before);
  });
}

for (let key of ["TOKEN", "UNKNOWN"]) {
  test(`fake GitLab refuses missing exact-scope variable ${key}`, (t) => {
    let project = hostFixture(t, "gitlab", {
      variables: [{ key: "TOKEN", environment_scope: "*" }],
    });
    let before = project.host();
    let result = fakeGitLabRequest(
      project.dir,
      `variables/${key}?filter%5Benvironment_scope%5D=dev`,
      "DELETE",
    );
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.deepEqual(project.host(), before);
  });
}

for (let ci of ["github", "gitlab"]) {
  test(`${ci}: publishing environment removal preserves its host records`, (t) => {
    let project = hostFixture(t, ci, {
      environments: [{ id: 2, name: "dev", state: "available" }],
    });
    writeFileSync(join(project.environments, "dev.env"), PRODUCTION);
    let refused = run(project.dir, "remove", "dev", "--yes");
    assert.equal(refused.status, 1, refused.output);
    assert.match(refused.output, /publishing environment.*--keep-host/i);
    assert.equal(project.read("dev"), PRODUCTION);
    assert.deepEqual(project.calls(), []);
    let removed = run(project.dir, "remove", "dev", "--keep-host", "--yes");
    assert.equal(removed.status, 0, removed.output);
    assert.equal(existsSync(join(project.environments, "dev.env")), false);
    assert.deepEqual(project.host().environments, [
      { id: 2, name: "dev", state: "available" },
    ]);
    assert.deepEqual(project.calls(), []);
  });
}

for (let ci of ["github", "gitlab"]) {
  test(`${ci}: env add reminds about RELEASE_TOKEN only for Maintainer-only GitHub releases, without host calls`, (t) => {
    let calls: unknown[] = [];
    for (let setting of ["true", "false", "", null]) {
      let project = hostFixture(t, ci);
      if (setting !== null) {
        writeFileSync(
          join(project.dir, "scripts/release/config.sh"),
          `RELEASE_TIMEZONE=UTC\n${setting && `RELEASE_MAINTAINERS_ONLY=${setting}\n`}`,
        );
      }
      let result = run(project.dir, "add", "uat", "--yes");
      assert.equal(result.status, 0, result.output);
      if (ci === "github" && setting === "true") {
        assert.match(
          result.output,
          /Maintainer-only releases are on: add RELEASE_TOKEN as a secret on the uat environment in GitHub and allow deployments to it only from main; see "Maintainer-only releases" in RELEASE\.md\./,
        );
      } else {
        assert.doesNotMatch(result.output, /RELEASE_TOKEN/);
      }
      calls.push(project.calls());
    }
    for (let other of calls.slice(1)) assert.deepEqual(other, calls[0]);
  });
}

for (let ci of ["github", "gitlab"]) {
  test(`${ci}: env remove never prints the RELEASE_TOKEN reminder, even with Maintainer-only releases on`, (t) => {
    for (let keepHost of [[], ["--keep-host"]]) {
      let project = hostFixture(t, ci, {
        environments: [{ id: 2, name: "dev", state: "available" }],
      });
      writeFileSync(
        join(project.dir, "scripts/release/config.sh"),
        "RELEASE_TIMEZONE=UTC\nRELEASE_MAINTAINERS_ONLY=true\n",
      );
      writeFileSync(
        join(project.environments, "dev.env"),
        "RELEASE_PUBLISH=false\n",
      );
      let removed = run(project.dir, "remove", "dev", ...keepHost, "--yes");
      assert.equal(removed.status, 0, removed.output);
      assert.equal(existsSync(join(project.environments, "dev.env")), false);
      assert.doesNotMatch(removed.output, /RELEASE_TOKEN/);
      let added = run(project.dir, "add", "dev", "--yes");
      assert.equal(added.status, 0, added.output);
      assert.equal(
        /RELEASE_TOKEN/.test(added.output),
        ci === "github",
        added.output,
      );
    }
  });
}
