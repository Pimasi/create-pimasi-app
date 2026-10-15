import { describe, it, expect } from "vitest";
import { $test } from "../test/helpers";

describe("GET /ping", () => {
    it("returns 200 with pong message", async () => {
        let res = await $test.get("/ping");

        expect(res.status).toBe(200);
        expect(res.data.message).toBe("pong");
        expect(res.data.version).toBeTypeOf("string");
        expect(res.data.commit).toBeTypeOf("string");
    });
});
