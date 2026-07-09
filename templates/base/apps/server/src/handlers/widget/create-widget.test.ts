import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { $test } from "../../test/helpers";

describe("POST /widgets", () => {
    let token: string;
    let userId: string;
    let createdIds: string[] = [];

    beforeAll(async () => {
        let seed = await $test.seed();
        token = seed.token;
        userId = seed.user.id;
    });

    afterAll(async () => {
        if (createdIds.length > 0) {
            let widgets = await $test.db.widgets();
            await widgets.deleteMany({ id: { $in: createdIds } });
        }
        await $test.teardownSeed();
    });

    it("returns 401 without auth token", async () => {
        let res = await $test.post("/widgets", { body: { name: "nope" } });
        expect(res.status).toBe(401);
    });

    it("returns 400 when name is missing", async () => {
        let res = await $test.post("/widgets", {
            token,
            body: { quantity: 3 },
        });
        expect(res.status).toBe(400);
    });

    it("returns 400 when name is empty", async () => {
        let res = await $test.post("/widgets", { token, body: { name: "" } });
        expect(res.status).toBe(400);
    });

    it("creates a widget with defaults", async () => {
        let res = await $test.post("/widgets", {
            token,
            body: { name: "Gadget" },
        });

        expect(res.status).toBe(200);
        createdIds.push(res.data.id);
        expect(typeof res.data.id).toBe("string");
        expect(res.data.name).toBe("Gadget");
        expect(res.data.description).toBe(null);
        expect(res.data.quantity).toBe(0);
        expect(typeof res.data.created_at).toBe("string");
        expect(typeof res.data.updated_at).toBe("string");
        expect(res.data).not.toHaveProperty("user_id");

        let widgets = await $test.db.widgets();
        let stored = await widgets.findOne({ id: res.data.id });
        expect(stored?.user_id).toBe(userId);
        expect(stored?.quantity).toBe(0);
        expect(stored?.description).toBe(null);
    });

    it("creates a widget with the provided fields", async () => {
        let res = await $test.post("/widgets", {
            token,
            body: { name: "Widget", description: "shiny", quantity: 7 },
        });

        expect(res.status).toBe(200);
        createdIds.push(res.data.id);
        expect(res.data.name).toBe("Widget");
        expect(res.data.description).toBe("shiny");
        expect(res.data.quantity).toBe(7);

        let widgets = await $test.db.widgets();
        let stored = await widgets.findOne({ id: res.data.id });
        expect(stored?.user_id).toBe(userId);
        expect(stored?.name).toBe("Widget");
        expect(stored?.quantity).toBe(7);
    });
});
