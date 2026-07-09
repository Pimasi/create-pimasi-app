import { describe, it, expect } from "vitest";
import { $test } from "../../test/helpers";

describe("POST /auth/login-with-email", () => {
    it("rejects missing body", async () => {
        let res = await $test.post("/auth/login-with-email");
        expect(res.status).toBe(400);
    });

    it("rejects missing email", async () => {
        let res = await $test.post("/auth/login-with-email", {
            body: { redirect_url: "https://example.test/callback" },
        });
        expect(res.status).toBe(400);
    });

    it("rejects invalid email format", async () => {
        let res = await $test.post("/auth/login-with-email", {
            body: {
                email: "not-an-email",
                redirect_url: "https://example.test/callback",
            },
        });
        expect(res.status).toBe(400);
    });

    it("rejects missing redirect_url", async () => {
        let res = await $test.post("/auth/login-with-email", {
            body: { email: "user@example.test" },
        });
        expect(res.status).toBe(400);
    });

    it.skip("rejects redirect_url on non-authorized domain", async () => {
        let res = await $test.post("/auth/login-with-email", {
            body: {
                email: "user@example.test",
                redirect_url: "https://evil.example.com/callback",
            },
        });
        expect(res.status).toBe(403);
    });
});
