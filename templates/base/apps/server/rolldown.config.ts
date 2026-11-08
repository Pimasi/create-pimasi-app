import { globSync } from "node:fs";
import { isAbsolute } from "node:path";
import { defineConfig } from "rolldown";

export default defineConfig({
    input: globSync("src/**/*.ts", {
        exclude: ["src/**/*.test.ts", "src/test/**"],
    }),
    platform: "node",
    external: (id) =>
        !id.startsWith(".") &&
        !isAbsolute(id) &&
        id !== "@pimasi/lib" &&
        !id.startsWith("@pimasi/lib/"),
    output: {
        dir: "dist",
        format: "esm",
        preserveModules: true,
        preserveModulesRoot: "src",
        sourcemap: true,
        cleanDir: true,
    },
});
