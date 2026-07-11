import { Boot } from "./boot";
import { attachWsServer } from "./ws-server";
import { $logger } from "../utils/logger";

export const WebsocketsBoot = Boot({
    name: "websockets",
    handler: ({ httpServer }) => {
        let wss = attachWsServer(httpServer);

        // Drain sockets on shutdown so a deploy/restart does not sever
        // connections mid-message. wss.close() stops accepting new upgrades;
        // existing clients are closed explicitly (1001 = going away).
        let shutdown = (signal: string) => {
            $logger.info({ signal }, "closing websocket server");
            for (let client of wss.clients) {
                client.close(1001, "server shutting down");
            }
            wss.close();
        };

        process.once("SIGTERM", () => shutdown("SIGTERM"));
        process.once("SIGINT", () => shutdown("SIGINT"));
    },
});
