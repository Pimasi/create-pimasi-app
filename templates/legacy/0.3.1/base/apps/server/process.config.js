const DEV_MODE = process.env.NODE_ENV !== "production";

console.log(`===PM2 DEV MODE: ${DEV_MODE}`);

const LOG_CONFIG = {
    out_file: "/dev/null",
    error_file: "/dev/null",
};

// Dev reload strategy — why not PM2's `watch`:
// The backend self-reloads from source via the `watch` npm script
// (`node --watch-path=./src --import tsx`). Node owns the watch + restart, so
// PM2's restart path is never touched. `--watch-path=./src` is a recursive
// *directory* watch (not the module graph): routes are autoloaded via
// globSync+require, so a brand-new *.route.ts must trigger a reload even
// though nothing imports it yet. (Plain `tsx watch` only watches its module
// graph and would silently miss new autoloaded files; that's why we use
// Node's watcher with tsx as the loader.) `tsc-watch` stays purely for
// type-checking feedback; nothing watches its dist output. Prod is unchanged:
// compiled dist, cluster mode.
const devApp = (name) => ({
    name,
    script: "npm",
    args: ["run", `dev:${name}`],
    kill_timeout: 2500,
    ...LOG_CONFIG,
});

const prodApp = (name, script) => ({
    name,
    script,
    exec_mode: "cluster",
    instances: process.env.PM2_INSTANCES || 1,
    kill_timeout: 2500,
    ...LOG_CONFIG,
});

module.exports = {
    apps: [
        DEV_MODE && {
            name: "tsc-watch",
            script: "npm",
            args: ["run", "build:watch"],
            ...LOG_CONFIG,
        },
        DEV_MODE ? devApp("backend") : prodApp("backend", "dist/backend.js"),
    ].filter(Boolean),
};
