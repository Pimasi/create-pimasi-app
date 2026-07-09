import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ulid } from "ulid";
import { $test } from "../../test/helpers";
import type { WidgetModel } from "../../models/widgets";

describe("GET /widgets", () => {
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
        let res = await $test.get("/widgets");
        expect(res.status).toBe(401);
    });

    it("lists only the caller's widgets, newest first", async () => {
        let widgets = await $test.db.widgets();
        let other = await $test.seedUser();

        let older: WidgetModel = {
            id: ulid(),
            user_id: userId,
            name: "older",
            description: null,
            quantity: 1,
            created_at: new Date("2024-01-01T00:00:00.000Z"),
            updated_at: new Date("2024-01-01T00:00:00.000Z"),
        };
        let newer: WidgetModel = {
            id: ulid(),
            user_id: userId,
            name: "newer",
            description: "fresh",
            quantity: 2,
            created_at: new Date("2024-06-01T00:00:00.000Z"),
            updated_at: new Date("2024-06-01T00:00:00.000Z"),
        };
        let foreign: WidgetModel = {
            id: ulid(),
            user_id: other.id,
            name: "foreign",
            description: null,
            quantity: 3,
            created_at: new Date("2024-07-01T00:00:00.000Z"),
            updated_at: new Date("2024-07-01T00:00:00.000Z"),
        };
        createdIds.push(older.id, newer.id, foreign.id);
        await widgets.insertMany([older, newer, foreign]);

        let res = await $test.get("/widgets", { token });

        expect(res.status).toBe(200);
        let ids = res.data.map((w: any) => w.id);
        expect(ids).toContain(newer.id);
        expect(ids).toContain(older.id);
        expect(ids).not.toContain(foreign.id);
        expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));

        let returned = res.data.find((w: any) => w.id === newer.id);
        expect(returned.created_at).toBe("2024-06-01T00:00:00.000Z");
        expect(returned).not.toHaveProperty("user_id");
    });
});
