import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { once } from "node:events";
import { WebSocket } from "ws";
import { getenv } from "@pimasi/utils/lib/helpers";
import { $test } from "../test/helpers";
import { $bus } from "../services/bus";
import { wsDispatch } from "../services/websocket";
import { $redis } from "../services/redis";

function wsUrl(token?: string): string {
    let base = getenv("TEST_URL").replace(/^http/, "ws");
    return token ? `${base}/ws?token=${token}` : `${base}/ws`;
}

describe("websockets", () => {
    let token: string;
    let userId: string;
    let sockets: WebSocket[] = [];

    beforeAll(async () => {
        let seed = await $test.seed();
        token = seed.token;
        userId = seed.user.id;
    });

    afterAll(async () => {
        sockets.forEach((socket) => socket.terminate());
        await $test.teardownSeed();
        await $bus.close();
        await $redis.close();
    });

    it("delivers an event published on ws.dispatch to the user's socket", async () => {
        let socket = new WebSocket(wsUrl(token));
        sockets.push(socket);

        await once(socket, "open", { signal: AbortSignal.timeout(5_000) });

        let received = once(socket, "message", {
            signal: AbortSignal.timeout(5_000),
        });

        await wsDispatch.publish({
            user_id: userId,
            event: { type: "notification", title: "hi" },
        });

        let [data] = await received;

        expect(JSON.parse(data.toString())).toEqual({
            type: "notification",
            title: "hi",
        });
    });

    it("refuses a connection without a token", async () => {
        let socket = new WebSocket(wsUrl());
        sockets.push(socket);

        let [err] = await once(socket, "error", {
            signal: AbortSignal.timeout(5_000),
        });

        expect(String(err)).toContain("401");
    });
});
