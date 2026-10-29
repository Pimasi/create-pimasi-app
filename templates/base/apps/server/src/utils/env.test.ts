import { describe, expect, it, vi } from "vitest";

describe("rate-limit switch", () => {
    it.each([
        [undefined, true],
        ["false", false],
        ["true", true],
    ] as const)(
        "reads RATE_LIMIT_ENABLED=%s as %s",
        async (value, expected) => {
            let original = process.env.RATE_LIMIT_ENABLED;
            try {
                if (value === undefined) delete process.env.RATE_LIMIT_ENABLED;
                else process.env.RATE_LIMIT_ENABLED = value;
                vi.resetModules();
                let { $env } = await import("./env");
                expect($env.RATE_LIMIT_ENABLED).toBe(expected);
            } finally {
                if (original === undefined)
                    delete process.env.RATE_LIMIT_ENABLED;
                else process.env.RATE_LIMIT_ENABLED = original;
            }
        },
    );
});
