import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
    it("verifies a password against its own hash", () => {
        let hash = hashPassword("correct horse battery staple");
        expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
    });

    it("rejects a wrong password", () => {
        let hash = hashPassword("correct horse battery staple");
        expect(verifyPassword("wrong password", hash)).toBe(false);
    });

    it("uses a unique salt per call (different hashes for same input)", () => {
        let a = hashPassword("hunter2");
        let b = hashPassword("hunter2");
        expect(a).not.toBe(b);
        expect(verifyPassword("hunter2", a)).toBe(true);
        expect(verifyPassword("hunter2", b)).toBe(true);
    });

    it("returns false on a malformed stored hash", () => {
        expect(verifyPassword("anything", "not$a$valid$hash")).toBe(false);
        expect(verifyPassword("anything", "")).toBe(false);
    });
});
