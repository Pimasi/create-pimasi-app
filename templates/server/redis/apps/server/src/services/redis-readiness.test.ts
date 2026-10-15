import { createServer } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runReadinessChecks } from "../app/readiness";
import { $test } from "../test/helpers";
import { $logger } from "../utils/logger";
import { RedisReadinessBoot } from "./redis-readiness.boot";
import { $redis } from "./redis";

describe("Redis readiness", () => {
    afterEach(() => vi.restoreAllMocks());

    it("pings live Redis before reporting ready", async () => {
        let ping = vi.spyOn($redis, "ping");
        await RedisReadinessBoot.handler({
            app: express(),
            httpServer: createServer(),
            isProduction: false,
        });

        expect(await runReadinessChecks()).toEqual({
            status: "ready",
            checks: { redis: "ok" },
        });
        expect(ping).toHaveBeenCalledOnce();
    });

    it("reports unavailable when the Redis ping rejects", async () => {
        let ping = vi
            .spyOn($redis, "ping")
            .mockRejectedValue(new Error("Redis unavailable"));
        vi.spyOn($logger, "error").mockImplementation(() => {});
        await RedisReadinessBoot.handler({
            app: express(),
            httpServer: createServer(),
            isProduction: false,
        });

        expect(await runReadinessChecks()).toEqual({
            status: "unavailable",
            checks: { redis: "failed" },
        });
        expect(ping).toHaveBeenCalledOnce();
    });

    it("registers a Redis check alongside the database check", async () => {
        let res = await $test.get("/ready");

        expect(res.status).toBe(200);
        expect(res.data).toEqual({
            status: "ready",
            checks: { database: "ok", redis: "ok" },
        });
    });
});
