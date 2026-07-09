import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function findTemplatesDir(): string {
    let current = dirname(fileURLToPath(import.meta.url));

    for (let i = 0; i < 8; i++) {
        const candidate = join(current, "templates");
        if (existsSync(candidate) && existsSync(join(current, "DESIGN.md"))) {
            return candidate;
        }

        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
    }

    throw new Error(
        "Could not locate templates/ directory (expected alongside DESIGN.md).",
    );
}
