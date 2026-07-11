import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function findCliRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));

  for (let i = 0; i < 8; i++) {
    if (
      existsSync(join(current, "templates")) &&
      existsSync(join(current, "DESIGN.md"))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    "Could not locate the CLI root (expected templates/ alongside DESIGN.md).",
  );
}

export function findTemplatesDir(): string {
  return join(findCliRoot(), "templates");
}

export function getCliVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(findCliRoot(), "package.json"), "utf8"),
  ) as { version?: string };
  return pkg.version ?? "0.0.0";
}
