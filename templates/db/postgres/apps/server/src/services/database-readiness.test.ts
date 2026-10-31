import { createServer } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runReadinessChecks } from "../app/readiness";
import { $logger } from "../utils/logger";
import { DatabaseReadinessBoot } from "./database-readiness.boot";
import { $db } from "./db";

describe("PostgreSQL readiness", () => {
    afterEach(() => vi.restoreAllMocks());

    it("queries the live database before reporting ready", async () => {
        let query = vi.spyOn($db.getExecutor(), "executeQuery");
        await DatabaseReadinessBoot.handler({
            app: express(),
            httpServer: createServer(),
            isProduction: false,
        });

        expect(await runReadinessChecks()).toEqual({
            status: "ready",
            checks: { database: "ok" },
        });
        expect(query).toHaveBeenCalledWith(
            expect.objectContaining({ sql: "select 1" }),
            undefined,
        );
    });

    it("reports unavailable when the database query rejects", async () => {
        let query = vi
            .spyOn($db.getExecutor(), "executeQuery")
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
        expect(query).toHaveBeenCalledWith(
            expect.objectContaining({ sql: "select 1" }),
            undefined,
        );
    });
});
