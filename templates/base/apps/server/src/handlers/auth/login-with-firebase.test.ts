import { describe, it, expect } from "vitest";
import { $test } from "../../test/helpers";

describe("POST /auth/login-with-firebase", () => {
    it("rejects request with no body", async () => {
        let res = await $test.post("/auth/login-with-firebase");
        expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("rejects request with empty token", async () => {
        let res = await $test.post("/auth/login-with-firebase", {
            body: { token: "" },
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("rejects request with invalid firebase token", async () => {
        let res = await $test.post("/auth/login-with-firebase", {
            body: { token: "invalid-firebase-token" },
        });
        expect([401, 501]).toContain(res.status);
    });

    it("rejects request with non-string token", async () => {
        let res = await $test.post("/auth/login-with-firebase", {
            body: { token: 12345 },
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
    });
});
