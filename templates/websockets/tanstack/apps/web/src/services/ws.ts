import type { WSEvent } from "@pimasi/lib/schemas/api/ws-events.schema";

export type WSMessageHandler = (event: WSEvent) => void;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

const handlers = new Set<WSMessageHandler>();

let socket: WebSocket | null = null;
let currentToken: string | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let manuallyClosed = true;

function wsUrl(token: string): string {
    let base = import.meta.env?.VITE_API_URL ?? "";
    let root = base.replace(/^http/, "ws").replace(/\/+$/, "");
    return `${root}/ws?token=${encodeURIComponent(token)}`;
}

function open(): void {
    if (manuallyClosed || !currentToken) return;

    let ws = new WebSocket(wsUrl(currentToken));
    socket = ws;

    ws.onopen = () => {
        reconnectAttempt = 0;
    };

    ws.onerror = (event) => {
        console.warn("websocket error", event);
    };

    ws.onmessage = (message) => {
        let event: WSEvent;
        try {
            event = JSON.parse(message.data);
        } catch (err) {
            console.warn("dropping invalid websocket payload", err);
            return;
        }
        for (let handler of handlers) handler(event);
    };

    ws.onclose = () => {
        if (socket !== ws) return;
        socket = null;
        scheduleReconnect();
    };
}

function scheduleReconnect(): void {
    if (manuallyClosed || !currentToken || reconnectTimer) return;

    let backoff = Math.min(
        RECONNECT_BASE_MS * 2 ** reconnectAttempt,
        RECONNECT_MAX_MS,
    );
    let delay = backoff / 2 + Math.random() * (backoff / 2);
    reconnectAttempt += 1;

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        open();
    }, delay);
}

export function connectWebSocket(token: string): void {
    disconnectWebSocket();
    currentToken = token;
    manuallyClosed = false;
    open();
}

export function disconnectWebSocket(): void {
    manuallyClosed = true;
    currentToken = null;
    reconnectAttempt = 0;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (socket) {
        let ws = socket;
        socket = null;
        ws.close();
    }
}

export function addMessageHandler(handler: WSMessageHandler): void {
    handlers.add(handler);
}

export function removeMessageHandler(handler: WSMessageHandler): void {
    handlers.delete(handler);
}
