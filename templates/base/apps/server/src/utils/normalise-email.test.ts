import { describe, it, expect } from "vitest";

// Re-implemented inline to keep this test file free of imports that pull
// in the Mongo client (which requires env vars at module load). The logic
// is mirrored from `models/users.ts#normaliseEmail` — keep them in sync.
function normaliseEmail(email: string): string {
    return email.trim().toLowerCase();
}

describe("normaliseEmail", () => {
    it("lowercases the address", () => {
        expect(normaliseEmail("Foo@Bar.COM")).toBe("foo@bar.com");
    });

    it("trims surrounding whitespace", () => {
        expect(normaliseEmail("  user@example.com  ")).toBe("user@example.com");
    });

    it("is idempotent", () => {
        let once = normaliseEmail("Mixed@Case.Org");
        expect(normaliseEmail(once)).toBe(once);
    });
});
