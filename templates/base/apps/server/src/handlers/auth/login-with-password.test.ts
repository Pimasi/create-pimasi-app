import { describe, it, expect } from "vitest";
import { $test } from "../../test/helpers";

describe("POST /auth/login-with-password", () => {
    it("rejects missing body", async () => {
        let res = await $test.post("/auth/login-with-password");
        expect(res.status).toBe(400);
    });

    it("rejects missing email", async () => {
        let res = await $test.post("/auth/login-with-password", {
            body: { password: "password123" },
        });
        expect(res.status).toBe(400);
    });

    it("rejects invalid email format", async () => {
        let res = await $test.post("/auth/login-with-password", {
            body: { email: "not-an-email", password: "password123" },
        });
        expect(res.status).toBe(400);
    });

    it("rejects missing password", async () => {
        let res = await $test.post("/auth/login-with-password", {
            body: { email: "nobody@example.test" },
        });
        expect(res.status).toBe(400);
    });

    it("rejects non-string password", async () => {
        let res = await $test.post("/auth/login-with-password", {
            body: { email: "nobody@example.test", password: 123456 },
        });
        expect(res.status).toBe(400);
    });

    it("returns 401 for unknown credentials", async () => {
        let res = await $test.post("/auth/login-with-password", {
            body: {
                email: "nonexistent-user@example.test",
                password: "wrong-password",
            },
        });
        expect(res.status).toBe(401);
    });
});
