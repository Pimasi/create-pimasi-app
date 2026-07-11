import { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { $jwt } from "../utils/jwt";
import { $logger } from "../utils/logger";
import { $websocket } from "../services/websocket";

const PING_INTERVAL_MS = 60_000;
const PONG_TIMEOUT_MS = 90_000;
const WATCHDOG_INTERVAL_MS = 30_000;

// setTimeout fires immediately for delays past this (~24.8 days), so long
// waits are re-armed in chunks below it.
const MAX_TIMER_MS = 2_147_483_647;

// Cap inbound frames even though the endpoint is push-only: without this a
// single frame can allocate the `ws` default of 100 MiB.
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

// Optional CSWSH defence: a comma-separated origin allowlist. Empty means any
// origin is accepted (the auth token lives in localStorage, not a cookie, so a
// cross-site page cannot attach it; the allowlist is defence-in-depth).
const ALLOWED_ORIGINS = (process.env.WS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

interface AuthContext {
    userId: string;
    /** epoch ms at which the token expires, or null if it never does */
    expiresAt: number | null;
}

// verifyClient runs before the "connection" event; stash the authenticated
// identity keyed by the request instead of mutating it with `any`.
const authenticated = new WeakMap<IncomingMessage, AuthContext>();

export function attachWsServer(httpServer: Server): WebSocketServer {
    let wss = new WebSocketServer({
        server: httpServer,
        path: "/ws",
        maxPayload: MAX_PAYLOAD_BYTES,
        verifyClient: (
            info: { req: IncomingMessage; origin: string; secure: boolean },
            done: (result: boolean, code?: number, message?: string) => void,
        ) => {
            if (!originAllowed(info.origin)) {
                return done(false, 403, "Forbidden origin");
            }

            let auth = authenticate(info.req);
            if (!auth) return done(false, 401, "Unauthorized");

            authenticated.set(info.req, auth);
            return done(true);
        },
    });

    wss.on("connection", (socket, req) => {
        let auth = authenticated.get(req);
        authenticated.delete(req);
        if (!auth) {
            // Unreachable while verifyClient gates connections, but never
            // register a socket we did not authenticate.
            socket.terminate();
            return;
        }

        let userId = auth.userId;
        let release = $websocket.register(userId, socket);
        $logger.info({ user_id: userId }, "websocket connected");

        let lastPong = Date.now();
        socket.on("pong", () => {
            lastPong = Date.now();
        });

        // Push-only endpoint: clients are not expected to send. Drop the
        // connection on unexpected inbound data to enforce the contract.
        socket.on("message", () => {
            $logger.debug(
                { user_id: userId },
                "unexpected ws inbound message, terminating",
            );
            socket.terminate();
        });

        let pingTimer = setInterval(() => pingSafely(socket), PING_INTERVAL_MS);
        let watchdogTimer = setInterval(() => {
            if (Date.now() - lastPong > PONG_TIMEOUT_MS) socket.terminate();
        }, WATCHDOG_INTERVAL_MS);

        // Close the socket when its token expires so a live connection cannot
        // outlive the credential that authorised it.
        let cancelExpiry =
            auth.expiresAt === null
                ? null
                : scheduleAt(auth.expiresAt, () =>
                      socket.close(4001, "token expired"),
                  );

        socket.on("close", () => {
            clearInterval(pingTimer);
            clearInterval(watchdogTimer);
            cancelExpiry?.();
            release();
            $logger.info({ user_id: userId }, "websocket disconnected");
        });
    });

    return wss;
}

function originAllowed(origin: string | undefined): boolean {
    if (ALLOWED_ORIGINS.length === 0) return true;
    if (!origin) return false;
    return ALLOWED_ORIGINS.includes(origin);
}

/** Run `fn` at absolute epoch `whenMs`, re-arming to survive the timer ceiling. */
function scheduleAt(whenMs: number, fn: () => void): () => void {
    let timer: ReturnType<typeof setTimeout>;
    let arm = () => {
        let delay = whenMs - Date.now();
        if (delay <= 0) return fn();
        timer = setTimeout(arm, Math.min(delay, MAX_TIMER_MS));
    };
    arm();
    return () => clearTimeout(timer);
}

function pingSafely(socket: WebSocket): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
        socket.ping();
    } catch (err) {
        $logger.debug({ err }, "ws ping failed");
    }
}

function authenticate(req: IncomingMessage): AuthContext | null {
    let url = new URL(req.url ?? "", "http://localhost");
    let token = url.searchParams.get("token");
    if (!token) return null;

    try {
        let parsed = $jwt.verify(token);
        if (parsed.type !== "user") return null;

        let decoded = jwt.decode(token);
        let expiresAt =
            decoded &&
            typeof decoded === "object" &&
            typeof decoded.exp === "number"
                ? decoded.exp * 1000
                : null;

        return { userId: parsed.user_id, expiresAt };
    } catch {
        return null;
    }
}
