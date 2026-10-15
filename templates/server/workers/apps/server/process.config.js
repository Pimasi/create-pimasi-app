const DEV_MODE = process.env.NODE_ENV !== "production";

console.log(`===PM2 DEV MODE: ${DEV_MODE}`);

const LOG_CONFIG = {
    out_file: "/dev/null",
    error_file: "/dev/null",
};

// Dev reload strategy — why not PM2's `watch`:
// `backend` and `workers` both run off the same compiled `dist/`, so a single
// `tsc` recompile fired BOTH PM2 watchers in the same tick. PM2 7.0.1's God
// daemon can't handle the two concurrent restarts: `processIsDead` double-fires
// the kill callback, the second firing re-enters an already-online process
// ("process already online") and pm2-runtime dies on async's "Callback was
// already called" — which takes the whole container down with exit 1. No mix of
// watch_delay / ignore_watch / exec_mode fixes it, because both apps are
// triggered by the same event at the same instant.
//
// Instead each process self-reloads from source via the shared `watch` npm
// script (`node --watch-path=./src --import tsx`). Node owns the watch + restart
// per process, so backend and workers reload independently and PM2's restart
// path — the thing that crashed — is never touched. `--watch-path=./src` is a
// recursive *directory* watch (not the module graph): routes and queues are
// autoloaded via globSync+require, so a brand-new *.route.ts / *.queue.ts must
// trigger a reload even though nothing imports it yet. (Plain `tsx watch` only
// watches its module graph and would silently miss new autoloaded files; that's
// why we use Node's watcher with tsx as the loader.) `tsc-watch` stays purely
// for type-checking feedback; nothing watches its dist output now. Prod is
// unchanged: compiled dist, cluster mode.
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
        DEV_MODE ? devApp("workers") : prodApp("workers", "dist/workers.js"),
    ].filter(Boolean),
};
