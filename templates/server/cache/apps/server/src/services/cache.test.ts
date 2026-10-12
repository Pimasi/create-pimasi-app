import { describe, it, expect, afterAll } from "vitest";
import { ulid } from "ulid";
import { $cache } from "./cache";
import { $redis } from "./redis";

const KEY_PREFIX = `cache-test:${ulid()}`;
let usedKeys: string[] = [];

function testKey(name: string): string {
    let key = `${KEY_PREFIX}:${name}:${ulid()}`;
    usedKeys.push(key);
    return key;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

afterAll(async () => {
    if (usedKeys.length > 0) await $redis.del(usedKeys);
    await $redis.close();
});

describe("$cache", () => {
    it("round-trips a value through set and get", async () => {
        let key = testKey("round-trip");
        let value = { name: "item", quantity: 3 };

        await $cache.set(key, value);

        expect(await $cache.get<typeof value>(key)).toEqual(value);
    });

    it("returns null on a cache miss", async () => {
        expect(await $cache.get(testKey("miss"))).toBeNull();
    });

    it("expires values after the ttl", async () => {
        let key = testKey("ttl");

        await $cache.set(key, "ephemeral", 1);
        expect(await $cache.get<string>(key)).toBe("ephemeral");

        await sleep(1200);

        expect(await $cache.get(key)).toBeNull();
    });

    it("deletes a value", async () => {
        let key = testKey("del");

        await $cache.set(key, "to-delete");
        await $cache.del(key);

        expect(await $cache.get(key)).toBeNull();
    });

    it("getOrSet loads once then serves from cache", async () => {
        let key = testKey("get-or-set");
        let loads = 0;
        let loader = async () => {
            loads += 1;
            return { loaded_at: loads };
        };

        let first = await $cache.getOrSet(key, 60, loader);
        let second = await $cache.getOrSet(key, 60, loader);

        expect(first).toEqual({ loaded_at: 1 });
        expect(second).toEqual({ loaded_at: 1 });
        expect(loads).toBe(1);
    });
});
