import { Boot } from "./boot";
import { attachWsServer } from "./ws-server";

export const WebsocketsBoot = Boot({
    name: "websockets",
    handler: ({ httpServer }) => {
        attachWsServer(httpServer);
    },
});
