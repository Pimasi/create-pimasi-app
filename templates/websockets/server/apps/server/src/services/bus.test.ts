import { describe, it, expect, afterAll } from "vitest";
import { ulid } from "ulid";
import { $bus } from "./bus";
import { $redis } from "./redis";

const RUN = ulid();
let streamKeys: string[] = [];

function channelName(label: string): string {
    return `bus-test.${label}.${RUN}`;
}

function durableName(label: string): string {
    let name = channelName(label);
    streamKeys.push(name);
    return name;
}

function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
    return new Promise((resolve, reject) => {
        let startedAt = Date.now();
        let timer = setInterval(() => {
            if (predicate()) {
                clearInterval(timer);
                resolve();
            } else if (Date.now() - startedAt > timeoutMs) {
                clearInterval(timer);
                reject(new Error("waitFor timed out"));
            }
        }, 25);
    });
}

afterAll(async () => {
    await $bus.close();
    if (streamKeys.length > 0) await $redis.del(streamKeys);
    await $redis.close();
});

describe("$bus", () => {
    it("broadcasts an ephemeral message to every subscriber", async () => {
        let channel = $bus.channel<{ n: number }>(channelName("broadcast"));
        let first: number[] = [];
        let second: number[] = [];

        let stopFirst = await channel.subscribe((payload) => {
            first.push(payload.n);
        });
        await channel.subscribe((payload) => {
            second.push(payload.n);
        });

        await channel.publish({ n: 1 });
        await waitFor(() => first.length === 1 && second.length === 1);

        await stopFirst();
        await channel.publish({ n: 2 });
        await waitFor(() => second.length === 2);

        expect(first).toEqual([1]);
        expect(second).toEqual([1, 2]);
    });

    it("delivers retained history and new messages to a durable group", async () => {
        let channel = $bus.channel<{ n: number }>(durableName("group"), {
            durable: true,
        });
        await channel.publish({ n: 1 });

        let seen: number[] = [];
        await channel.subscribe(
            (payload) => {
                seen.push(payload.n);
            },
            { group: "workers" },
        );

        await channel.publish({ n: 2 });
        await waitFor(() => seen.length === 2);

        expect([...seen].sort()).toEqual([1, 2]);
    });

    it("gives each group its own copy of a durable channel", async () => {
        let channel = $bus.channel<{ n: number }>(durableName("fan-out"), {
            durable: true,
        });
        let alpha: number[] = [];
        let beta: number[] = [];

        await channel.subscribe(
            (payload) => {
                alpha.push(payload.n);
            },
            { group: "alpha" },
        );
        await channel.subscribe(
            (payload) => {
                beta.push(payload.n);
            },
            { group: "beta" },
        );

        await channel.publish({ n: 7 });
        await waitFor(() => alpha.length === 1 && beta.length === 1);

        expect(alpha).toEqual([7]);
        expect(beta).toEqual([7]);
    });

    it("tails a durable channel from subscribe time without a group", async () => {
        let channel = $bus.channel<{ n: number }>(durableName("tail"), {
            durable: true,
        });
        await channel.publish({ n: 1 });

        let seen: number[] = [];
        let stop = await channel.subscribe((payload) => {
            seen.push(payload.n);
        });

        await channel.publish({ n: 2 });
        await waitFor(() => seen.length === 1);
        await stop();

        expect(seen).toEqual([2]);
    });

    it("rejects a group subscription on an ephemeral channel", async () => {
        let channel = $bus.channel(channelName("no-group"));

        await expect(
            channel.subscribe(() => undefined, { group: "workers" }),
        ).rejects.toThrow(/durable/);
    });

    it("returns the same channel on an identical redeclaration and throws on a conflict", () => {
        let name = channelName("declare");
        let channel = $bus.channel(name);

        expect($bus.channel(name)).toBe(channel);
        expect(() => $bus.channel(name, { durable: true })).toThrow(
            /different options/,
        );
    });
});
