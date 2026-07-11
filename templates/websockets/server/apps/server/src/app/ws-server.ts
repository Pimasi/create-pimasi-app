import { IncomingMessage, Server } from "node:http";
import { WebSocketServer } from "ws";
import { $jwt } from "../utils/jwt";
import { $logger } from "../utils/logger";
import { $websocket } from "../services/websocket";

const PING_INTERVAL_MS = 60_000;
const PONG_TIMEOUT_MS = 90_000;
const WATCHDOG_INTERVAL_MS = 30_000;

export function attachWsServer(httpServer: Server): WebSocketServer {
    let wss = new WebSocketServer({
        server: httpServer,
        path: "/ws",
        verifyClient: (
            info: { req: IncomingMessage },
            done: (result: boolean, code?: number, message?: string) => void,
        ) => {
            let userId = authenticate(info.req);
            if (!userId) return done(false, 401, "Unauthorized");

            (info.req as any).userId = userId;
            return done(true);
        },
    });

    wss.on("connection", (socket, req) => {
        let userId = (req as any).userId as string;

        $websocket.register(userId, socket);
        $logger.info({ user_id: userId }, "websocket connected");

        let lastPong = Date.now();
        socket.on("pong", () => {
            lastPong = Date.now();
        });

        let pingTimer = setInterval(() => socket.ping(), PING_INTERVAL_MS);
        let watchdogTimer = setInterval(() => {
            if (Date.now() - lastPong > PONG_TIMEOUT_MS) socket.terminate();
        }, WATCHDOG_INTERVAL_MS);

        socket.on("close", () => {
            clearInterval(pingTimer);
            clearInterval(watchdogTimer);
            $websocket.unregister(userId, socket);
            $logger.info({ user_id: userId }, "websocket disconnected");
        });
    });

    return wss;
}

function authenticate(req: IncomingMessage): string | null {
    let url = new URL(req.url ?? "", "http://localhost");
    let token = url.searchParams.get("token");
    if (!token) return null;

    try {
        let parsed = $jwt.verify(token);
        if (parsed.type !== "user") return null;
        return parsed.user_id;
    } catch {
        return null;
    }
}
