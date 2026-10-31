import { afterEach, describe, expect, it, vi } from "vitest";
import { registerReadinessCheck, runReadinessChecks } from "./readiness";
import { $logger } from "../utils/logger";

describe("readiness checks", () => {
    let removeChecks: (() => void)[] = [];

    afterEach(() => {
        removeChecks.reverse().forEach((remove) => remove());
        removeChecks = [];
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("is ready with no registered checks", async () => {
        expect(await runReadinessChecks()).toEqual({
            status: "ready",
            checks: {},
        });
    });

    it("runs checks in parallel with separate two-second deadlines", async () => {
        vi.useFakeTimers();
        let errors = vi.spyOn($logger, "error").mockImplementation(() => {});
        let started: string[] = [];
        for (let name of ["slow", "stalled"]) {
            removeChecks.push(
                registerReadinessCheck(name, async () => {
                    started.push(name);
                    await new Promise(() => {});
                }),
            );
        }
        removeChecks.push(registerReadinessCheck("fast", async () => {}));

        let result = runReadinessChecks();
        await vi.advanceTimersByTimeAsync(2_000);

        expect(started).toEqual(["slow", "stalled"]);
        expect(await result).toEqual({
            status: "unavailable",
            checks: { slow: "failed", stalled: "failed", fast: "ok" },
        });
        expect(errors).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("logs errors and restores an overridden check", async () => {
        let error = new Error("private connection details");
        let errors = vi.spyOn($logger, "error").mockImplementation(() => {});
        removeChecks.push(registerReadinessCheck("database", async () => {}));
        let restore = registerReadinessCheck("database", async () => {
            throw error;
        });
        removeChecks.push(restore);

        expect(await runReadinessChecks()).toEqual({
            status: "unavailable",
            checks: { database: "failed" },
        });
        expect(errors).toHaveBeenCalledWith(
            { name: "database", err: error },
            "readiness check failed",
        );
        restore();
        expect(await runReadinessChecks()).toEqual({
            status: "ready",
            checks: { database: "ok" },
        });
    });
});
