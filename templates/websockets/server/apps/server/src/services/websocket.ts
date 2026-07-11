import { WebSocket } from "ws";
import { jsonStringify } from "@pimasi/utils/lib/helpers";
import { WSEvent } from "@pimasi/lib/schemas/api/ws-events.schema";
import { $pubsub } from "./pubsub";
import { $logger } from "../utils/logger";

const DISPATCH_CHANNEL = "ws:dispatch";

const localSockets = new Map<string, Set<WebSocket>>();

$pubsub
    .subscribe(DISPATCH_CHANNEL, (payload) => {
        let message = payload as { user_id?: unknown; event?: unknown };

        if (
            typeof message?.user_id !== "string" ||
            message.event === undefined
        ) {
            $logger.warn({ payload }, "dropped malformed ws dispatch message");
            return;
        }

        let sockets = localSockets.get(message.user_id);
        if (!sockets) return;

        let data = jsonStringify(message.event);
        for (let socket of sockets) {
            if (socket.readyState === WebSocket.OPEN) socket.send(data);
        }
    })
    .catch((err) => $logger.error(err, "ws dispatch subscription failed"));

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

    register(userId: string, socket: WebSocket): void {
        let sockets = localSockets.get(userId);
        if (!sockets) {
            sockets = new Set();
            localSockets.set(userId, sockets);
        }
        sockets.add(socket);
    },

    unregister(userId: string, socket: WebSocket): void {
        let sockets = localSockets.get(userId);
        if (!sockets) return;

        sockets.delete(socket);
        if (sockets.size === 0) localSockets.delete(userId);
    },
};
