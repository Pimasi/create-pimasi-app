import { createClient } from "redis";
import { $env } from "../utils/env";
import { $logger } from "../utils/logger";

const client = createClient({
    url: $env.REDIS_URL,
    socket: {
        tls: false,
    },
});

client.on("error", (err) => $logger.error(err, "redis client error"));

client
    .connect()
    .then(() => $logger.info(`redis connection established`))
    .catch((err) => $logger.error(err, "redis connection failed"));

export const $redis = client;
