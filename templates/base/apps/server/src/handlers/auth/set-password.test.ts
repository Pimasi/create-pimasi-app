import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { $test } from "../../test/helpers";

describe("POST /auth/set-password", () => {
    let token: string;

    beforeAll(async () => {
        let seed = await $test.seed();
        token = seed.token;
    });

    afterAll(async () => {
        await $test.teardownSeed();
    });

    it("returns 401 without auth token", async () => {
        let res = await $test.post("/auth/set-password", {
            body: { password: "newpassword123" },
        });
        expect(res.status).toBe(401);
    });

    it("rejects empty password", async () => {
        let res = await $test.post("/auth/set-password", {
            token,
            body: { password: "" },
        });
        expect(res.status).toBe(400);
    });

    it("rejects password shorter than 6 characters", async () => {
        let res = await $test.post("/auth/set-password", {
            token,
            body: { password: "abc" },
        });
        expect(res.status).toBe(400);
    });

    it("rejects missing password field", async () => {
        let res = await $test.post("/auth/set-password", {
            token,
            body: {},
        });
        expect(res.status).toBe(400);
    });

    it("rejects non-string password", async () => {
        let res = await $test.post("/auth/set-password", {
            token,
            body: { password: 123456 },
        });
        expect(res.status).toBe(400);
    });
});
