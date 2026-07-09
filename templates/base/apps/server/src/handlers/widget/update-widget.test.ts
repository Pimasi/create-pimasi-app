import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ulid } from "ulid";
import { $test } from "../../test/helpers";
import type { WidgetModel } from "../../models/widgets";

async function insertWidget(userId: string): Promise<WidgetModel> {
    let createdAt = new Date("2024-01-01T00:00:00.000Z");
    let widget: WidgetModel = {
        id: ulid(),
        user_id: userId,
        name: "before",
        description: "before",
        quantity: 1,
        created_at: createdAt,
        updated_at: createdAt,
    };
    let widgets = await $test.db.widgets();
    await widgets.insertOne(widget);
    return widget;
}

describe("PATCH /widgets/:id", () => {
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
        let res = await $test.patch(`/widgets/${ulid()}`, {
            body: { name: "after" },
        });
        expect(res.status).toBe(401);
    });

    it("returns 400 for an invalid body", async () => {
        let widget = await insertWidget(userId);
        createdIds.push(widget.id);

        let res = await $test.patch(`/widgets/${widget.id}`, {
            token,
            body: { name: "" },
        });
        expect(res.status).toBe(400);
    });

    it("updates the provided fields and bumps updated_at", async () => {
        let widget = await insertWidget(userId);
        createdIds.push(widget.id);

        let res = await $test.patch(`/widgets/${widget.id}`, {
            token,
            body: { name: "after", quantity: 9 },
        });

        expect(res.status).toBe(200);
        expect(res.data.name).toBe("after");
        expect(res.data.quantity).toBe(9);
        expect(res.data.description).toBe("before");
        expect(res.data).not.toHaveProperty("user_id");

        let widgets = await $test.db.widgets();
        let stored = await widgets.findOne({ id: widget.id });
        expect(stored?.name).toBe("after");
        expect(stored?.quantity).toBe(9);
        expect(stored?.updated_at.getTime()).toBeGreaterThan(
            widget.updated_at.getTime(),
        );
    });

    it("clears the description when passed null", async () => {
        let widget = await insertWidget(userId);
        createdIds.push(widget.id);

        let res = await $test.patch(`/widgets/${widget.id}`, {
            token,
            body: { description: null },
        });

        expect(res.status).toBe(200);
        expect(res.data.description).toBe(null);
    });

    it("returns 404 for a missing id", async () => {
        let res = await $test.patch(`/widgets/${ulid()}`, {
            token,
            body: { name: "after" },
        });
        expect(res.status).toBe(404);
    });

    it("returns 404 for another user's widget", async () => {
        let other = await $test.seedUser();
        let widget = await insertWidget(other.id);
        createdIds.push(widget.id);

        let res = await $test.patch(`/widgets/${widget.id}`, {
            token,
            body: { name: "after" },
        });
        expect(res.status).toBe(404);

        let widgets = await $test.db.widgets();
        let stored = await widgets.findOne({ id: widget.id });
        expect(stored?.name).toBe("before");
    });
});
