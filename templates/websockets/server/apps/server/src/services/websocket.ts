import { WebSocket } from "ws";
import { jsonStringify } from "@pimasi/utils/lib/helpers";
import { Schema } from "@pimasi/utils/lib/json-schema";
import {
    WSEvent,
    WSEventSchema,
} from "@pimasi/lib/schemas/api/ws-events.schema";
import { $pubsub } from "./pubsub";
import { $logger } from "../utils/logger";

const DISPATCH_CHANNEL = "ws:dispatch";

// Terminate a socket whose outbound buffer grows past this: a client that stops
// reading must not make the server buffer without bound.
const MAX_BUFFERED_BYTES = 1024 * 1024;

// Bound concurrent sockets per user (tabs/devices) so one token cannot exhaust
// file descriptors or memory. The oldest is evicted to make room.
const MAX_SOCKETS_PER_USER = 20;

// Retry the dispatch subscription so a transient failure at boot does not
// permanently disable delivery.
const SUBSCRIBE_RETRY_BASE_MS = 1_000;
const SUBSCRIBE_RETRY_MAX_MS = 30_000;

const localSockets = new Map<string, Set<WebSocket>>();

function sendIfOpen(socket: WebSocket, payload: string, userId: string): void {
    if (socket.readyState !== WebSocket.OPEN) return;

    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        $logger.warn(
            { user_id: userId, buffered: socket.bufferedAmount },
            "ws consumer over buffer limit, terminating socket",
        );
        socket.terminate();
        return;
    }

    try {
        socket.send(payload);
    } catch (err) {
        $logger.warn({ err, user_id: userId }, "ws dispatch send failed");
    }
}

function handleDispatch(payload: unknown): void {
    let message = payload as { user_id?: unknown; event?: unknown };

    if (typeof message?.user_id !== "string" || message.event === undefined) {
        $logger.warn({ payload }, "dropped malformed ws dispatch message");
        return;
    }

    try {
        Schema.validate(message.event, WSEventSchema);
    } catch (err) {
        $logger.warn(
            { err },
            "dropped ws dispatch event failing schema validation",
        );
        return;
    }

    let sockets = localSockets.get(message.user_id);
    if (!sockets) return;

    let data = jsonStringify(message.event);
    for (let socket of sockets) sendIfOpen(socket, data, message.user_id);
}

async function subscribeWithRetry(attempt = 0): Promise<void> {
    try {
        await $pubsub.subscribe(DISPATCH_CHANNEL, handleDispatch);
        if (attempt > 0) $logger.info("ws dispatch subscription recovered");
    } catch (err) {
        let delay = Math.min(
            SUBSCRIBE_RETRY_BASE_MS * 2 ** attempt,
            SUBSCRIBE_RETRY_MAX_MS,
        );
        $logger.error(
            err,
            `ws dispatch subscription failed, retrying in ${delay}ms`,
        );
        setTimeout(() => void subscribeWithRetry(attempt + 1), delay);
    }
}

void subscribeWithRetry();

export const $websocket = {
    async send(userId: string, event: WSEvent): Promise<void> {
        await $pubsub.publish(DISPATCH_CHANNEL, { user_id: userId, event });
    },

    async sendToMany(userIds: string[], event: WSEvent): Promise<void> {
        await Promise.all(
            userIds.map((userId) => $websocket.send(userId, event)),
        );
    },

    isUserOnline(userId: string): boolean {
        return localSockets.has(userId);
    },

    register(userId: string, socket: WebSocket): () => void {
        let sockets = localSockets.get(userId);
        if (!sockets) {
            sockets = new Set();
            localSockets.set(userId, sockets);
        }

        // Keep the per-user set bounded by evicting the oldest socket(s).
        while (sockets.size >= MAX_SOCKETS_PER_USER) {
            let oldest = sockets.values().next().value as WebSocket | undefined;
            if (!oldest) break;
            sockets.delete(oldest);
            $logger.warn(
                { user_id: userId },
                "per-user socket cap reached, evicting oldest",
            );
            try {
                oldest.terminate();
            } catch {
                // best-effort eviction
            }
        }
        sockets.add(socket);

        let released = false;
        return () => {
            if (released) return;
            released = true;

            let current = localSockets.get(userId);
            if (!current) return;
            current.delete(socket);
            if (current.size === 0) localSockets.delete(userId);
        };
    },
};
