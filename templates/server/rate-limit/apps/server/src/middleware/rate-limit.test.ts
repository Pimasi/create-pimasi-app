import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { RATE_LIMIT } from "./rate-limit";
import { $env } from "../utils/env";
import { $redis } from "../services/redis";

vi.mock("../utils/env", () => ({
    $env: { NODE_ENV: "production", RATE_LIMIT_ENABLED: true },
}));

vi.mock("../services/redis", () => ({
    $redis: { incr: vi.fn(), expire: vi.fn() },
}));

vi.mock("../utils/logger", () => ({
    $logger: { warn: vi.fn() },
}));

describe("RATE_LIMIT", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        $env.RATE_LIMIT_ENABLED = true;
    });

    it("skips production requests without touching Redis when disabled", async () => {
        $env.RATE_LIMIT_ENABLED = false;
        let next = vi.fn();
        let res = { setHeader: vi.fn() } as unknown as Response;
        let resolve = vi.fn(() => "user:123");
        let handler = RATE_LIMIT({
            bucket: "auth",
            key: resolve,
            max: 5,
            windowSeconds: 60,
        });

        await handler({ url: "/auth" } as Request, res, next);

        expect(next).toHaveBeenCalledExactlyOnceWith();
        expect($redis.incr).not.toHaveBeenCalled();
        expect($redis.expire).not.toHaveBeenCalled();
        expect(resolve).not.toHaveBeenCalled();
    });

    it("refuses a keyless production request with its bucket when enabled", async () => {
        let next = vi.fn();
        let handler = RATE_LIMIT({
            bucket: "login-email",
            key: () => undefined,
            max: 5,
            windowSeconds: 60,
        });

        await expect(
            handler({ url: "/auth" } as Request, {} as Response, next),
        ).rejects.toMatchObject({
            statusCode: 429,
            message: "RATE_LIMIT_NO_KEY",
            context: { bucket: "login-email" },
        });
        expect(next).not.toHaveBeenCalled();
        expect($redis.incr).not.toHaveBeenCalled();
        expect($redis.expire).not.toHaveBeenCalled();
    });
});
