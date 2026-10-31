import {
    ReadinessStatus,
    ReadinessCheckStatus,
} from "@pimasi/lib/values/health";
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
            status: ReadinessStatus.READY,
            checks: { database: ReadinessCheckStatus.OK },
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
            status: ReadinessStatus.UNAVAILABLE,
            checks: { database: ReadinessCheckStatus.FAILED },
        });
        expect(query).toHaveBeenCalledWith(
            expect.objectContaining({ sql: "select 1" }),
            undefined,
        );
    });
});
