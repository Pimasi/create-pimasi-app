import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ulid } from "ulid";
import { $test } from "../../test/helpers";
import type { WidgetModel } from "../../models/widgets";

async function insertWidget(userId: string): Promise<WidgetModel> {
    let now = new Date();
    let widget: WidgetModel = {
        id: ulid(),
        user_id: userId,
        name: "target",
        description: null,
        quantity: 5,
        created_at: now,
        updated_at: now,
    };
    let widgets = await $test.db.widgets();
    await widgets.insertOne(widget);
    return widget;
}

describe("GET /widgets/:id", () => {
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
        let res = await $test.get(`/widgets/${ulid()}`);
        expect(res.status).toBe(401);
    });

    it("returns the caller's widget", async () => {
        let widget = await insertWidget(userId);
        createdIds.push(widget.id);

        let res = await $test.get(`/widgets/${widget.id}`, { token });

        expect(res.status).toBe(200);
        expect(res.data.id).toBe(widget.id);
        expect(res.data.name).toBe("target");
        expect(res.data.quantity).toBe(5);
        expect(res.data).not.toHaveProperty("user_id");
    });

    it("returns 404 for a missing id", async () => {
        let res = await $test.get(`/widgets/${ulid()}`, { token });
        expect(res.status).toBe(404);
    });

    it("returns 404 for another user's widget", async () => {
        let other = await $test.seedUser();
        let widget = await insertWidget(other.id);
        createdIds.push(widget.id);

        let res = await $test.get(`/widgets/${widget.id}`, { token });
        expect(res.status).toBe(404);
    });
});
