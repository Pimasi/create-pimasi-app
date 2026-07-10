import { $redis } from "./redis";

export const $cache = {
    async get<T>(key: string): Promise<T | null> {
        let raw = await $redis.get(key);
        if (raw === null) return null;
        return JSON.parse(raw) as T;
    },

    async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
        let raw = JSON.stringify(value);
        if (ttlSeconds !== undefined) {
            await $redis.set(key, raw, {
                expiration: { type: "EX", value: ttlSeconds },
            });
        } else {
            await $redis.set(key, raw);
        }
    },

    async del(key: string): Promise<void> {
        await $redis.del(key);
    },

    async getOrSet<T>(
        key: string,
        ttlSeconds: number,
        loader: () => Promise<T>,
    ): Promise<T> {
        let cached = await $cache.get<T>(key);
        if (cached !== null) return cached;

        let value = await loader();
        await $cache.set(key, value, ttlSeconds);
        return value;
    },
};
