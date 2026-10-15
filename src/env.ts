import {
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
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
  text,
} from "@clack/prompts";
import pc from "picocolors";
import { RELEASE_CONFIG } from "./compose.js";
import { MANIFEST_FILENAME, readManifest } from "./generate.js";

const ENVIRONMENT_DIR = "scripts/release/environments";
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ASSIGNMENT_PATTERN =
  /([ \t]*(?:export[ \t]+)?)([A-Za-z_][A-Za-z0-9_]*)=((?:"(?:\\[^\r\n]|[^"\\$`])*"|'[^']*'|\\[^\r\n]|[^ \t\r\n"'\\$`;|&<>()])*)([ \t]*(?:#[^\r\n]*)?)(\r?\n|$)/y;
const COMMENT_PATTERN = /[ \t]*(?:#[^\r\n]*)?(?:\r?\n|$)/y;
const VALUE_PATTERN = /^("(?:\\.|[^"\\])*"|'[^']*'|[^ \t"']*)([ \t]*(?:#.*)?)$/;
const PREREQUISITE_MESSAGE =
  'Run "pimasi add ci-github" or "pimasi add ci-gitlab" first; environments require a CI host and scripts/release/environments/production.env.';

type ReleaseKey =
  | "RELEASE_PUBLISH"
  | "RELEASE_HEALTH_URL"
  | "RELEASE_AFTER"
  | "RELEASE_ON_MERGE";
type Relation = "independent" | "before" | "after";

interface Environment {
  content: string;
  after: string;
  publishes: boolean;
  health: boolean;
  onMerge: boolean;
}

interface HostEnvironment {
  id: number;
  name: string;
  state?: string;
}

function hostAccess(projectDir: string, ci: "github" | "gitlab") {
  let tool = ci === "github" ? "gh" : "glab";
  let remote = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (remote.status !== 0) throw new Error("no readable origin remote");
  let address = remote.stdout.trim();
  let scp = address.match(/^[^@/]+@([^:/]+):(.+)$/);
  let url = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : address);
  if (!["ssh:", "https:", "http:", "git:"].includes(url.protocol)) {
    throw new Error("no supported origin remote");
  }
  let project = url.pathname.replace(/^\//, "").replace(/\.git$/, "");
  if (!project.includes("/") || project.endsWith("/")) {
    throw new Error("no project in origin remote");
  }
  let endpoint =
    ci === "github"
      ? `repos/${project}`
      : `projects/${encodeURIComponent(project)}`;
  let call = (path: string, method = "GET", args: string[] = []) => {
    let result = spawnSync(
      tool,
      [
        "api",
        `${endpoint}/${path}`,
        "--hostname",
        url.host,
        "--method",
        method,
        ...args,
      ],
      {
        cwd: projectDir,
        encoding: "utf8",
        timeout: 10000,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          GH_PROMPT_DISABLED: "1",
          GLAB_PROMPT_DISABLED: "1",
        },
      },
    );
    if (result.status !== 0) {
      throw new Error(
        `${tool} unavailable, not signed in or without sufficient rights`,
      );
    }
    return result.stdout;
  };
  let list = (path: string) => {
    let output = call(
      path,
      "GET",
      ci === "github"
        ? ["--paginate", "--slurp"]
        : ["--paginate", "--output", "ndjson"],
    );
    if (ci === "github") {
      return JSON.parse(output).flatMap(
        (page: { environments: HostEnvironment[] }) => page.environments,
      );
    }
    return output.trim()
      ? output
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
  };
  return {
    call,
    list,
    environments: () => list("environments?per_page=100") as HostEnvironment[],
  };
}

function changeHost(
  projectDir: string,
  ci: "github" | "gitlab",
  command: "add" | "remove",
  name: string,
): string {
  let changed = false;
  try {
    let host = hostAccess(projectDir, ci);
    let existing = host
      .environments()
      .find((environment) => environment.name === name);
    if (command === "add") {
      if (existing) return `Host environment "${name}" already exists.`;
      host.call(
        ci === "github" ? `environments/${name}` : "environments",
        ci === "github" ? "PUT" : "POST",
        ci === "github" ? [] : ["--raw-field", `name=${name}`],
      );
      return `Created host environment "${name}".`;
    }
    if (ci === "gitlab") {
      let variables = host.list("variables?per_page=100") as {
        key: string;
        environment_scope: string;
      }[];
      if (existing && existing.state !== "stopped") {
        host.call(`environments/${existing.id}/stop`, "POST", [
          "--field",
          "force=true",
        ]);
        changed = true;
      }
      for (let variable of variables) {
        if (variable.environment_scope !== name) continue;
        host.call(
          `variables/${encodeURIComponent(variable.key)}?filter%5Benvironment_scope%5D=${name}`,
          "DELETE",
        );
        changed = true;
      }
    }
    if (!existing) {
      return ci === "github"
        ? `Host environment "${name}" is not yet created.`
        : `Host environment "${name}" is not yet created; its exact-scope project variables were removed where present.`;
    }
    host.call(`environments/${ci === "github" ? name : existing.id}`, "DELETE");
    return `Deleted host environment "${name}" and its host-side secrets.`;
  } catch (error) {
    let reason =
      error instanceof SyntaxError || error instanceof TypeError
        ? "the host configuration could not be read"
        : (error as Error).message;
    return command === "add"
      ? `Host environment "${name}" could not be created (${reason}); the first promotion will create it.`
      : `The host environment "${name}" is left in place (${reason}); ${changed ? "its configuration may be partly removed" : "remove it on the host when available"}.`;
  }
}

function fail(message: string): never {
  cancel(message);
  process.exit(1);
}

function answer<T>(value: T): Exclude<T, symbol> {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }
  return value as Exclude<T, symbol>;
}

function validateName(name: string | undefined): string | undefined {
  if (!name) return "An environment name is required.";
  if (!NAME_PATTERN.test(name)) {
    return "Use lower-case letters, digits and dashes, starting with a letter or digit, at most 32 characters.";
  }
  return undefined;
}

function assignments(content: string, name: string) {
  let entries: RegExpExecArray[] = [];
  let offset = 0;
  while (offset < content.length) {
    COMMENT_PATTERN.lastIndex = offset;
    let comment = COMMENT_PATTERN.exec(content);
    if (comment) {
      offset += comment[0].length;
      continue;
    }
    ASSIGNMENT_PATTERN.lastIndex = offset;
    let assignment = ASSIGNMENT_PATTERN.exec(content);
    if (!assignment) {
      fail(
        `${name}.env: unsupported shell syntax; use literal assignments and comments.`,
      );
    }
    entries.push(assignment);
    offset += assignment[0].length;
  }
  return entries;
}

function readValues(content: string, name: string): Record<ReleaseKey, string> {
  let values = {
    RELEASE_PUBLISH: "false",
    RELEASE_HEALTH_URL: "",
    RELEASE_AFTER: "",
    RELEASE_ON_MERGE: "false",
  };
  for (let match of assignments(content, name)) {
    if (!Object.hasOwn(values, match[2])) continue;
    let parsed = match[3].match(VALUE_PATTERN);
    if (!parsed || /[\r\n]/.test(match[3])) {
      fail(`${name}.env: ${match[2]} must be a single literal assignment.`);
    }
    let value = parsed[1];
    if (value.startsWith('"') || value.startsWith("'")) {
      value = value.slice(1, -1);
    }
    values[match[2] as ReleaseKey] = value;
  }
  if (!["", "true", "false"].includes(values.RELEASE_PUBLISH)) {
    fail(`${name}.env: RELEASE_PUBLISH must be true or false.`);
  }
  if (values.RELEASE_AFTER && validateName(values.RELEASE_AFTER)) {
    fail(`${name}.env: RELEASE_AFTER must name an environment literally.`);
  }
  if (!["", "true", "false"].includes(values.RELEASE_ON_MERGE)) {
    fail(`${name}.env: RELEASE_ON_MERGE must be true or false.`);
  }
  return values;
}

function setValue(
  content: string,
  key: ReleaseKey,
  value: string | null,
): string {
  let found = false;
  let updated = content;
  for (let entry of assignments(content, "environment").reverse()) {
    let [line, prefix, matchedKey, , suffix, ending] = entry;
    if (matchedKey !== key) continue;
    found = true;
    let replacement = `${prefix}${key}=${value}${suffix}${ending}`;
    if (value === null) {
      replacement = suffix.includes("#")
        ? `${prefix.replace(/export[ \t]+$/, "")}${suffix.trimStart()}${ending}`
        : "";
    }
    updated =
      updated.slice(0, entry.index) +
      replacement +
      updated.slice(entry.index + line.length);
  }
  if (!found && value !== null) {
    let ending = content.includes("\r\n") ? "\r\n" : "\n";
    if (updated && !updated.endsWith("\n")) updated += ending;
    updated += `${key}=${value}${ending}`;
  }
  return updated;
}

function assertRelations(environments: Map<string, Environment>): void {
  for (let [name, environment] of environments) {
    if (environment.after && !environments.has(environment.after)) {
      fail(
        `Unknown environment "${environment.after}" in ${name}.env RELEASE_AFTER.`,
      );
    }
    let seen = new Set<string>();
    let current = name;
    while (current) {
      if (seen.has(current)) {
        fail(`Environment relation cycle: ${[...seen, current].join(" -> ")}.`);
      }
      seen.add(current);
      current = environments.get(current)?.after ?? "";
    }
  }
}

function maintainersOnly(projectDir: string): boolean {
  let path = join(projectDir, RELEASE_CONFIG);
  if (!existsSync(path)) return false;
  let value = "";
  for (let match of readFileSync(path, "utf8").matchAll(
    /^[ \t]*(?:export[ \t]+)?RELEASE_MAINTAINERS_ONLY=(["']?)([^"'\s#]*)\1/gm,
  )) {
    value = match[2];
  }
  return value === "true";
}

function nextSteps(ci: "github" | "gitlab", name: string): void {
  note(
    [
      `Edit the placeholders in ${ENVIRONMENT_DIR}/${name}.env.`,
      "Plug each target into scripts/release/deploy.sh.",
      "Commit the environment files on main before promoting.",
      "git fetch origin main",
      "SHA=$(git rev-parse origin/main)",
      ci === "github"
        ? `gh workflow run release.yml --ref main -f sha="$SHA" -f environment=${name}`
        : `glab ci run --branch main --input "sha:$SHA" --input "environment:${name}"`,
    ].join("\n"),
    "Next steps",
  );
}

export async function runEnv(
  args: string[],
  projectDir: string,
): Promise<void> {
  intro(pc.inverse(pc.cyan(" pimasi env ")));
  try {
    let { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        after: { type: "string" },
        before: { type: "string" },
        "on-merge": { type: "boolean" },
        publish: { type: "boolean" },
        "keep-host": { type: "boolean" },
        yes: { type: "boolean", short: "y" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      console.log(
        "Usage:\n  pimasi env list\n  pimasi env add <name> [--after <environment> | --before <environment>] [--on-merge] [--publish] [--yes]\n  pimasi env remove <name> [--keep-host] [--yes]",
      );
      return;
    }
    let [command, name] = positionals;
    if (!["list", "add", "remove"].includes(command)) {
      fail("Specify an environment command: pimasi env list|add|remove.");
    }
    if (positionals.length > (command === "list" ? 1 : 2)) {
      fail(`Too many arguments for pimasi env ${command}.`);
    }
    if (values.after !== undefined && values.before !== undefined) {
      fail("Choose either --after or --before, not both.");
    }
    if (command !== "add" && values["on-merge"] !== undefined) {
      fail("--on-merge is only valid with pimasi env add.");
    }
    if (command !== "add" && values.publish !== undefined) {
      fail("--publish is only valid with pimasi env add.");
    }
    if (command !== "remove" && values["keep-host"] !== undefined) {
      fail("--keep-host is only valid with pimasi env remove.");
    }
    if (
      command !== "add" &&
      (values.after !== undefined || values.before !== undefined)
    ) {
      fail("--after and --before are only valid with pimasi env add.");
    }
    let manifest = readManifest(projectDir);
    if (!manifest) {
      fail(`No ${MANIFEST_FILENAME} found here. ${PREREQUISITE_MESSAGE}`);
    }
    if (
      !["github", "gitlab"].includes(manifest.ci ?? "") ||
      !existsSync(join(projectDir, ENVIRONMENT_DIR, "production.env"))
    ) {
      fail(PREREQUISITE_MESSAGE);
    }
    let ci = manifest.ci as "github" | "gitlab";
    let environments = new Map<string, Environment>();
    let snapshot = new Map<string, string>();
    for (let file of readdirSync(join(projectDir, ENVIRONMENT_DIR)).sort()) {
      if (!file.endsWith(".env")) continue;
      let environmentName = file.slice(0, -4);
      let error = validateName(environmentName);
      if (error) fail(`Invalid environment file "${file}". ${error}`);
      let content = readFileSync(
        join(projectDir, ENVIRONMENT_DIR, file),
        "utf8",
      );
      let settings = readValues(content, environmentName);
      snapshot.set(file, content);
      environments.set(environmentName, {
        content,
        after: settings.RELEASE_AFTER,
        publishes: settings.RELEASE_PUBLISH === "true",
        health: settings.RELEASE_HEALTH_URL !== "",
        onMerge: settings.RELEASE_ON_MERGE === "true",
      });
    }
    assertRelations(environments);
    if (command === "list") {
      let hostEnvironments: HostEnvironment[] | undefined;
      try {
        hostEnvironments = hostAccess(projectDir, ci).environments();
      } catch {}
      let rows = [
        [
          "Name",
          "Given",
          "Publishes",
          "Follows",
          "Health URL",
          "On merge",
          "Host",
        ],
        ...[...environments].map(([environmentName, environment]) => [
          environmentName,
          environmentName === "production" ? "yes" : "no",
          environment.publishes ? "yes" : "no",
          environment.after || "independent",
          environment.health ? "set" : "unset",
          environment.onMerge ? "yes" : "no",
          hostEnvironments === undefined
            ? "unknown"
            : hostEnvironments.some((host) => host.name === environmentName)
              ? "exists"
              : "not yet created",
        ]),
      ];
      let widths = rows[0].map((_, column) =>
        Math.max(...rows.map((row) => row[column].length)),
      );
      console.log(
        rows
          .map((row) =>
            row
              .map((cell, column) => cell.padEnd(widths[column]))
              .join("  ")
              .trimEnd(),
          )
          .join("\n"),
      );
      nextSteps(ci, "production");
      outro("Done.");
      return;
    }
    let relation: Relation =
      values.before !== undefined
        ? "before"
        : values.after !== undefined
          ? "after"
          : "independent";
    let target = values.before ?? values.after;
    let interactive = !values.yes && Boolean(process.stdin.isTTY);
    let onMerge = values["on-merge"] ?? false;
    let publish = values.publish ?? false;
    if (command === "add" && interactive) {
      name = answer(
        await text({
          message: "Environment name?",
          initialValue: name,
          validate: validateName,
        }),
      );
    }
    let nameError = validateName(name);
    if (nameError) fail(`${nameError} Use pimasi env ${command} <name> --yes.`);
    if (name === "production") {
      fail(
        `Production is the given environment and cannot be ${command === "add" ? "added" : "removed"}.`,
      );
    }
    if (command === "add" && environments.has(name)) {
      fail(
        `Environment "${name}" already exists; its file will not be overwritten.`,
      );
    }
    if (command === "remove" && !environments.has(name)) {
      fail(`Unknown environment "${name}".`);
    }
    if (
      command === "remove" &&
      environments.get(name)!.publishes &&
      !values["keep-host"]
    ) {
      fail(
        `Removing a publishing environment could erase release records; use --keep-host to remove "${name}" locally.`,
      );
    }
    if (command === "add" && target !== undefined) {
      if (target === name) {
        fail(`Environment relation cycle: ${name} -> ${name}.`);
      }
      if (!environments.has(target)) fail(`Unknown environment "${target}".`);
    }
    if (command === "add" && interactive) {
      relation = answer(
        await select<Relation>({
          message: "How does this environment relate to the others?",
          initialValue: relation,
          options: [
            {
              value: "independent",
              label: "Independent",
              hint: "promote in any order",
            },
            { value: "before", label: "Before an environment" },
            { value: "after", label: "After an environment" },
          ],
        }),
      );
      if (relation !== "independent") {
        target = answer(
          await select({
            message: `${relation === "before" ? "Before" : "After"} which environment?`,
            initialValue: target,
            options: [...environments.keys()].map((environmentName) => ({
              value: environmentName,
              label: environmentName,
            })),
          }),
        );
      }
      onMerge = answer(
        await confirm({
          message: "Deploy automatically after a merge to main?",
          initialValue: onMerge,
        }),
      );
      publish = answer(
        await confirm({
          message: "Create a version when deployed here?",
          initialValue: publish,
        }),
      );
    }
    if (
      command === "remove" &&
      !interactive &&
      !values.yes &&
      !values["keep-host"]
    ) {
      fail(
        "Removing host-side secrets needs confirmation; use --yes or --keep-host.",
      );
    }
    if (command === "remove" && interactive) {
      if (
        !answer(
          await confirm({
            message: values["keep-host"]
              ? `Remove environment "${name}" locally and keep its host configuration?`
              : `Remove environment "${name}", its host-side secrets and deployment history?`,
            initialValue: false,
          }),
        )
      ) {
        cancel("Cancelled.");
        return;
      }
    }
    let changes = new Map<string, string>();
    let reports: string[] = [];
    let path = join(projectDir, ENVIRONMENT_DIR, `${name}.env`);
    if (command === "add") {
      if (relation !== "independent") {
        if (target === name) {
          fail(`Environment relation cycle: ${name} -> ${name}.`);
        }
        if (!target || !environments.has(target)) {
          fail(`Unknown environment "${target ?? ""}".`);
        }
      }
      let after =
        relation === "after"
          ? target!
          : relation === "before"
            ? environments.get(target!)!.after
            : "";
      let content = environments.get("production")!.content;
      content = setValue(
        content,
        "RELEASE_PUBLISH",
        publish ? "true" : "false",
      );
      content = setValue(content, "RELEASE_HEALTH_URL", "");
      content = setValue(content, "RELEASE_AFTER", after || null);
      content = setValue(content, "RELEASE_ON_MERGE", onMerge ? "true" : null);
      environments.set(name, {
        content,
        after,
        publishes: publish,
        health: false,
        onMerge,
      });
      if (relation === "before") {
        let following = environments.get(target!)!;
        following.after = name;
        changes.set(
          target!,
          setValue(following.content, "RELEASE_AFTER", name),
        );
        reports.push(
          after
            ? `Inserted ${name} between ${after} and ${target}: ${after} -> ${name} -> ${target}.`
            : `${target} now follows ${name}.`,
        );
      } else {
        reports.push(
          after
            ? `${name} follows ${after}.`
            : `${name} is independent and can be promoted in any order.`,
        );
      }
      assertRelations(environments);
    } else {
      let after = environments.get(name)!.after;
      for (let [followingName, following] of environments) {
        if (following.after !== name) continue;
        following.after = after;
        changes.set(
          followingName,
          setValue(following.content, "RELEASE_AFTER", after || null),
        );
        reports.push(
          after
            ? `${followingName} now follows ${after}.`
            : `${followingName} is now independent.`,
        );
      }
      environments.delete(name);
      assertRelations(environments);
    }
    let currentFiles = readdirSync(join(projectDir, ENVIRONMENT_DIR)).filter(
      (file) => file.endsWith(".env"),
    );
    if (
      currentFiles.length !== snapshot.size ||
      currentFiles.some(
        (file) =>
          !snapshot.has(file) ||
          readFileSync(join(projectDir, ENVIRONMENT_DIR, file), "utf8") !==
            snapshot.get(file),
      )
    ) {
      fail(
        "Environment files changed while the command was open. Run it again.",
      );
    }
    if (command === "add") {
      writeFileSync(path, environments.get(name)!.content, { flag: "wx" });
      log.success(`Created ${ENVIRONMENT_DIR}/${name}.env`);
    }
    for (let [changedName, content] of changes) {
      writeFileSync(
        join(projectDir, ENVIRONMENT_DIR, `${changedName}.env`),
        content,
      );
      log.success(`Changed ${ENVIRONMENT_DIR}/${changedName}.env`);
    }
    if (command === "remove") {
      unlinkSync(path);
      log.success(`Deleted ${ENVIRONMENT_DIR}/${name}.env`);
    }
    reports.push(
      command === "remove" && values["keep-host"]
        ? `The host environment "${name}" and its configuration are left in place.`
        : changeHost(projectDir, ci, command as "add" | "remove", name),
    );
    for (let report of reports) log.info(report);
    if (command === "add" && ci === "github" && maintainersOnly(projectDir)) {
      log.warn(
        `Maintainer-only releases are on: add RELEASE_TOKEN as a secret on the ${name} environment in GitHub and allow deployments to it only from main; see "Maintainer-only releases" in RELEASE.md.`,
      );
    }
    nextSteps(ci, command === "add" ? name : "production");
    outro(pc.green("Done."));
  } catch (error) {
    fail((error as Error).message);
  }
}
