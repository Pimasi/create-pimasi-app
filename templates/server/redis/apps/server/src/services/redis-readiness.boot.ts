import { Boot } from "../app/boot";
import { registerReadinessCheck } from "../app/readiness";
import { $redis } from "./redis";

export const RedisReadinessBoot = Boot({
    name: "redis-readiness",
    handler: () => {
        registerReadinessCheck("redis", async () => {
            await $redis.ping();
        });
    },
});
