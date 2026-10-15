import { createServer } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runReadinessChecks } from "../app/readiness";
import { $logger } from "../utils/logger";
import { DatabaseReadinessBoot } from "./database-readiness.boot";
import { $mongo } from "./db";

describe("MongoDB readiness", () => {
    afterEach(() => vi.restoreAllMocks());

    it("pings the live database before reporting ready", async () => {
        let command = vi.spyOn($mongo, "command");
        await DatabaseReadinessBoot.handler({
            app: express(),
            httpServer: createServer(),
            isProduction: false,
        });

        expect(await runReadinessChecks()).toEqual({
            status: "ready",
            checks: { database: "ok" },
        });
        expect(command).toHaveBeenCalledWith({ ping: 1 });
    });

    it("reports unavailable when the database ping rejects", async () => {
        let command = vi
            .spyOn($mongo, "command")
            .mockRejectedValue(new Error("database unavailable"));
        vi.spyOn($logger, "error").mockImplementation(() => {});
        await DatabaseReadinessBoot.handler({
            app: express(),
            httpServer: createServer(),
            isProduction: false,
        });

        expect(await runReadinessChecks()).toEqual({
            status: "unavailable",
            checks: { database: "failed" },
        });
        expect(command).toHaveBeenCalledWith({ ping: 1 });
    });
});
