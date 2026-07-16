import { ulid } from "ulid";
import { sleep } from "@pimasi/utils/lib/helpers";
import { $redis } from "./redis";
import { $logger } from "../utils/logger";
import type {
    BusChannelDescriptor,
    BusDriver,
    BusSubscribeOptions,
} from "./bus";

const READ_COUNT = 32;
const READ_BLOCK_MS = 5_000;
const CLAIM_MIN_IDLE_MS = 60_000;
const READ_RETRY_MS = 1_000;

async function createSubscriber() {
    let client = $redis.duplicate();
    client.on("error", (err) => $logger.error(err, "redis subscriber error"));
    await client.connect();
    return client;
}

let subscriberPromise: ReturnType<typeof createSubscriber> | null = null;

function getSubscriber() {
    if (!subscriberPromise) {
        subscriberPromise = createSubscriber().catch((err) => {
            // Do not cache a failed connection, so a later call can retry.
            subscriberPromise = null;
            throw err;
        });
    }
    return subscriberPromise;
}

type StreamClient = Awaited<ReturnType<typeof createStreamClient>>;

interface StreamReader {
    client: StreamClient;
    stopped: boolean;
    done: Promise<void>;
}

const readers = new Set<StreamReader>();

async function createStreamClient() {
    let client = $redis.duplicate();
    client.on("error", (err) =>
        $logger.error(err, "redis stream reader error"),
    );
    await client.connect();
    return client;
}

async function lastGeneratedId(
    client: StreamClient,
    name: string,
): Promise<string> {
    try {
        let info = await client.xInfoStream(name);
        return String(info["last-generated-id"]);
    } catch (err) {
        if (!String(err).toLowerCase().includes("no such key")) throw err;
        return "0-0";
    }
}

async function ensureGroup(
    client: StreamClient,
    name: string,
    group: string,
): Promise<void> {
    try {
        await client.xGroupCreate(name, group, "0", { MKSTREAM: true });
    } catch (err) {
        if (!String(err).includes("BUSYGROUP")) throw err;
    }
}

function entryPayload(
    channel: BusChannelDescriptor,
    entry: { id: unknown; message: unknown },
): string | null {
    let data = (entry.message as Record<string, unknown>)?.payload;
    if (typeof data === "string") return data;

    $logger.warn(
        { channel: channel.name, id: String(entry.id) },
        "dropped stream entry without a payload field",
    );
    return null;
}

async function runGroupLoop(
    reader: StreamReader,
    channel: BusChannelDescriptor,
    group: string,
    onMessage: (data: string) => Promise<void>,
): Promise<void> {
    let consumer = ulid();

    let deliver = async (entry: { id: unknown; message: unknown }) => {
        let data = entryPayload(channel, entry);
        if (data !== null) await onMessage(data);
        await reader.client.xAck(channel.name, group, String(entry.id));
    };

    while (!reader.stopped) {
        try {
            let claimed = await reader.client.xAutoClaim(
                channel.name,
                group,
                consumer,
                CLAIM_MIN_IDLE_MS,
                "0-0",
                { COUNT: READ_COUNT },
            );
            for (let entry of claimed.messages) {
                if (entry) await deliver(entry);
            }

            let reply = await reader.client.xReadGroup(
                group,
                consumer,
                { key: channel.name, id: ">" },
                { COUNT: READ_COUNT, BLOCK: READ_BLOCK_MS },
            );
            if (!reply) continue;

            for (let stream of reply) {
                for (let entry of stream.messages) {
                    await deliver(entry);
                }
            }
        } catch (err) {
            if (reader.stopped) break;
            $logger.error(
                err,
                `bus stream read failed on channel "${channel.name}"`,
            );
            await sleep(READ_RETRY_MS);
        }
    }
}

async function runTailLoop(
    reader: StreamReader,
    channel: BusChannelDescriptor,
    startId: string,
    onMessage: (data: string) => Promise<void>,
): Promise<void> {
    let lastId = startId;

    while (!reader.stopped) {
        try {
            let reply = await reader.client.xRead(
                { key: channel.name, id: lastId },
                { COUNT: READ_COUNT, BLOCK: READ_BLOCK_MS },
            );
            if (!reply) continue;

            for (let stream of reply) {
                for (let entry of stream.messages) {
                    lastId = String(entry.id);
                    let data = entryPayload(channel, entry);
                    if (data !== null) await onMessage(data);
                }
            }
        } catch (err) {
            if (reader.stopped) break;
            $logger.error(
                err,
                `bus stream read failed on channel "${channel.name}"`,
            );
            await sleep(READ_RETRY_MS);
        }
    }
}

async function stopReader(reader: StreamReader): Promise<void> {
    if (!readers.delete(reader)) return;
    reader.stopped = true;
    reader.client.destroy();
    await reader.done;
}

export const busDriver: BusDriver = {
    async publish(channel: BusChannelDescriptor, data: string): Promise<void> {
        if (channel.durable) {
            await $redis.xAdd(
                channel.name,
                "*",
                { payload: data },
                {
                    TRIM: {
                        strategy: "MAXLEN",
                        strategyModifier: "~",
                        threshold: channel.maxLen,
                    },
                },
            );
            return;
        }

        await $redis.publish(channel.name, data);
    },

    async subscribe(
        channel: BusChannelDescriptor,
        onMessage: (data: string) => Promise<void>,
        options: BusSubscribeOptions,
    ): Promise<() => Promise<void>> {
        if (!channel.durable) {
            let subscriber = await getSubscriber();
            let listener = (message: string) => {
                void onMessage(message);
            };

            await subscriber.subscribe(channel.name, listener);

            return async () => {
                await subscriber.unsubscribe(channel.name, listener);
            };
        }

        let client = await createStreamClient();
        let reader: StreamReader = {
            client,
            stopped: false,
            done: Promise.resolve(),
        };

        try {
            if (options.group !== undefined) {
                await ensureGroup(client, channel.name, options.group);
                reader.done = runGroupLoop(
                    reader,
                    channel,
                    options.group,
                    onMessage,
                );
            } else {
                let startId = await lastGeneratedId(client, channel.name);
                reader.done = runTailLoop(reader, channel, startId, onMessage);
            }
        } catch (err) {
            client.destroy();
            throw err;
        }

        readers.add(reader);

        return async () => {
            await stopReader(reader);
        };
    },

    async close(): Promise<void> {
        await Promise.all([...readers].map((reader) => stopReader(reader)));

        if (subscriberPromise) {
            let subscriber = await subscriberPromise.catch(() => null);
            subscriberPromise = null;
            if (subscriber) await subscriber.close();
        }
    },
};
