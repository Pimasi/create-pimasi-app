import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { $test } from "../../test/helpers";

describe("GET /auth/session-user", () => {
    let token: string;
    let userId: string;
    let userEmail: string;

    beforeAll(async () => {
        let seed = await $test.seed();
        token = seed.token;
        userId = seed.user.id;
        userEmail = seed.user.email;
    });

    afterAll(async () => {
        await $test.teardownSeed();
    });

    it("returns 401 without auth token", async () => {
        let res = await $test.get("/auth/session-user");
        expect(res.status).toBe(401);
    });

    it("returns 401 with invalid token", async () => {
        let res = await $test.get("/auth/session-user", {
            token: "invalid.jwt.token",
        });
        expect(res.status).toBe(401);
    });

    it("returns the authenticated user", async () => {
        let res = await $test.get("/auth/session-user", { token });

        expect(res.status).toBe(200);
        expect(res.data.id).toBe(userId);
        expect(res.data.email).toBe(userEmail);
    });

    it("includes all expected user fields", async () => {
        let res = await $test.get("/auth/session-user", { token });

        expect(res.status).toBe(200);
        expect(res.data.id).toBeTypeOf("string");
        expect(res.data.email).toBeTypeOf("string");
        expect(
            res.data.firebase_id === null ||
                typeof res.data.firebase_id === "string",
        ).toBe(true);
        expect(res.data.name).toBeTypeOf("string");
        expect(Array.isArray(res.data.roles)).toBe(true);
    });
});
