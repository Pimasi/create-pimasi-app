import { jsonStringify, jsonParse } from "@pimasi/utils/lib/helpers";
import { $logger } from "../utils/logger";
import { busDriver } from "./bus-driver";

const BUS_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DEFAULT_MAX_LEN = 10_000;

export interface BusChannelOptions {
    durable?: boolean;
    maxLen?: number;
}

export interface BusSubscribeOptions {
    group?: string;
}

export interface BusChannelDescriptor {
    name: string;
    durable: boolean;
    maxLen: number;
}

export interface BusDriver {
    publish(channel: BusChannelDescriptor, data: string): Promise<void>;
    subscribe(
        channel: BusChannelDescriptor,
        onMessage: (data: string) => Promise<void>,
        options: BusSubscribeOptions,
    ): Promise<() => Promise<void>>;
    close(): Promise<void>;
}

export interface BusChannel<T> {
    readonly name: string;
    readonly durable: boolean;
    publish(payload: T): Promise<void>;
    subscribe(
        handler: (payload: T) => void | Promise<void>,
        options?: BusSubscribeOptions,
    ): Promise<() => Promise<void>>;
}

const channels = new Map<
    string,
    { descriptor: BusChannelDescriptor; channel: BusChannel<any> }
>();

function createChannel<T>(descriptor: BusChannelDescriptor): BusChannel<T> {
    return {
        name: descriptor.name,
        durable: descriptor.durable,

        async publish(payload: T): Promise<void> {
            await busDriver.publish(descriptor, jsonStringify(payload));
        },

        async subscribe(
            handler: (payload: T) => void | Promise<void>,
            options: BusSubscribeOptions = {},
        ): Promise<() => Promise<void>> {
            if (options.group !== undefined) {
                if (!descriptor.durable) {
                    throw new Error(
                        `bus channel "${descriptor.name}" is ephemeral: consumer groups need a durable channel`,
                    );
                }
                if (!BUS_NAME_PATTERN.test(options.group)) {
                    throw new Error(
                        `invalid bus group "${options.group}": use letters, digits, dots, dashes and underscores`,
                    );
                }
            }

            return busDriver.subscribe(
                descriptor,
                async (data) => {
                    let payload = jsonParse<T>(data);

                    if (payload === undefined) {
                        $logger.warn(
                            { channel: descriptor.name, data },
                            "dropped bus message with invalid JSON",
                        );
                        return;
                    }

                    try {
                        await handler(payload);
                    } catch (err) {
                        $logger.error(
                            err,
                            `bus handler failed on channel "${descriptor.name}"`,
                        );
                    }
                },
                options,
            );
        },
    };
}

export const $bus = {
    channel<T = unknown>(
        name: string,
        options: BusChannelOptions = {},
    ): BusChannel<T> {
        if (!BUS_NAME_PATTERN.test(name)) {
            throw new Error(
                `invalid bus channel name "${name}": use letters, digits, dots, dashes and underscores`,
            );
        }
        if (options.maxLen !== undefined && options.durable !== true) {
            throw new Error(
                `bus channel "${name}": maxLen only applies to durable channels`,
            );
        }

        let descriptor: BusChannelDescriptor = {
            name,
            durable: options.durable === true,
            maxLen: options.maxLen ?? DEFAULT_MAX_LEN,
        };

        let existing = channels.get(name);
        if (existing) {
            if (
                existing.descriptor.durable !== descriptor.durable ||
                existing.descriptor.maxLen !== descriptor.maxLen
            ) {
                throw new Error(
                    `bus channel "${name}" is already declared with different options`,
                );
            }
            return existing.channel as BusChannel<T>;
        }

        let channel = createChannel<T>(descriptor);
        channels.set(name, { descriptor, channel });
        return channel;
    },

    async close(): Promise<void> {
        await busDriver.close();
    },
};
