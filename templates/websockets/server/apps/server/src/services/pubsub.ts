import { jsonStringify, jsonParse } from "@pimasi/utils/lib/helpers";
import { $redis } from "./redis";
import { $logger } from "../utils/logger";

async function createSubscriber() {
    let client = $redis.duplicate();
    client.on("error", (err) => $logger.error(err, "redis subscriber error"));
    await client.connect();
    return client;
}

let subscriberPromise: ReturnType<typeof createSubscriber> | null = null;

function getSubscriber() {
    if (!subscriberPromise) {
        subscriberPromise = createSubscriber();
    }
    return subscriberPromise;
}

export const $pubsub = {
    async publish(channel: string, payload: unknown): Promise<void> {
        await $redis.publish(channel, jsonStringify(payload));
    },

    async subscribe(
        channel: string,
        handler: (payload: unknown) => void,
    ): Promise<void> {
        let subscriber = await getSubscriber();

        await subscriber.subscribe(channel, (message) => {
            let payload = jsonParse(message);

            if (payload === undefined) {
                $logger.warn(
                    { channel, message },
                    "dropped pub/sub message with invalid JSON",
                );
                return;
            }

            handler(payload);
        });
    },
};
