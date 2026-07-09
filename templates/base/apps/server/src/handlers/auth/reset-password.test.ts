import { describe, it, expect } from "vitest";
import { $test } from "../../test/helpers";

describe("POST /auth/reset-password", () => {
    let originHeaders = { "X-Frontend-Origin": "http://localhost:5173" };

    it("returns 204 for unknown email (no-op enqueue)", async () => {
        let res = await $test.post("/auth/reset-password", {
            body: { email: "nonexistent-user@example.test" },
            headers: originHeaders,
        });
        expect(res.status).toBe(204);
    });

    it("returns 204 for a well-formed request", async () => {
        let res = await $test.post("/auth/reset-password", {
            body: { email: "another-nonexistent@example.test" },
            headers: originHeaders,
        });
        expect(res.status).toBe(204);
    });
});
