import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

describe("production process count", () => {
    it.each([undefined, "", "3"])(
        "treats PM2_INSTANCES=%s as the requested count or one",
        (value) => {
            let env = { ...process.env, NODE_ENV: "production" };
            if (value === undefined) delete env.PM2_INSTANCES;
            else env.PM2_INSTANCES = value;
            let output = execFileSync(
                process.execPath,
                [
                    "-e",
                    'console.log(JSON.stringify(require("./process.config.js").apps.map((app) => app.instances)))',
                ],
                { env, encoding: "utf8" },
            );
            let counts = JSON.parse(output.trim().split("\n").at(-1)!);

            expect(counts.length).toBeGreaterThan(0);
            expect(counts).toEqual(counts.map(() => value || 1));
        },
    );
});
