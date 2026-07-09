import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { $test } from "../../test/helpers";

describe("POST /auth/register", () => {
    let existingEmail: string;

    beforeAll(async () => {
        let seed = await $test.seed();
        existingEmail = seed.user.email;
    });

    afterAll(async () => {
        await $test.teardownSeed();
    });

    it("rejects missing body", async () => {
        let res = await $test.post("/auth/register");
        expect(res.status).toBe(400);
    });

    it("rejects missing email", async () => {
        let res = await $test.post("/auth/register", {
            body: { password: "password123" },
        });
        expect(res.status).toBe(400);
    });

    it("rejects invalid email format", async () => {
        let res = await $test.post("/auth/register", {
            body: { email: "not-an-email", password: "password123" },
        });
        expect(res.status).toBe(400);
    });

    it("rejects missing password", async () => {
        let res = await $test.post("/auth/register", {
            body: { email: "new-user@example.test" },
        });
        expect(res.status).toBe(400);
    });

    it("rejects password shorter than 6 characters", async () => {
        let res = await $test.post("/auth/register", {
            body: { email: "new-user@example.test", password: "abc" },
        });
        expect(res.status).toBe(400);
    });

    it("rejects non-string password", async () => {
        let res = await $test.post("/auth/register", {
            body: { email: "new-user@example.test", password: 123456 },
        });
        expect(res.status).toBe(400);
    });

    it("returns 409 when email already exists", async () => {
        let res = await $test.post("/auth/register", {
            body: { email: existingEmail, password: "password123" },
        });
        expect(res.status).toBe(409);
        expect(res.data.error).toMatch(/already exists/i);
    });
});
