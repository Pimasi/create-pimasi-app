import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    type ReactNode,
} from "react";
import type {
    WSEvent,
    WSEventByType,
    WSEventType,
} from "@pimasi/lib/schemas/api/ws-events.schema";
import { $token } from "../services/token-storage";
import {
    addMessageHandler,
    connectWebSocket,
    disconnectWebSocket,
    removeMessageHandler,
} from "../services/ws";
import { useAuth } from "./use-auth";

type Subscribe = <T extends WSEventType>(
    type: T,
    handler: (event: WSEventByType<T>) => void,
) => () => void;

const WebSocketContext = createContext<{ subscribe: Subscribe } | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
    let { user } = useAuth();
    let subscriptionsRef = useRef(
        new Map<WSEventType, Set<(event: WSEvent) => void>>(),
    );

    useEffect(() => {
        if (!user) return;

        let token = $token.getAuth();
        if (!token) return;

        let onMessage = (event: WSEvent) => {
            let subscribers = subscriptionsRef.current.get(event.type);
            if (!subscribers) return;
            for (let handler of subscribers) handler(event);
        };

        addMessageHandler(onMessage);
        connectWebSocket(token);

        return () => {
            removeMessageHandler(onMessage);
            disconnectWebSocket();
        };
    }, [user]);

    let subscribe: Subscribe = useCallback((type, handler) => {
        let subscriptions = subscriptionsRef.current;
        let subscribers = subscriptions.get(type);
        if (!subscribers) {
            subscribers = new Set();
            subscriptions.set(type, subscribers);
        }
        let listener = handler as (event: WSEvent) => void;
        subscribers.add(listener);
        return () => {
            subscribers.delete(listener);
        };
    }, []);

    return (
        <WebSocketContext.Provider value={{ subscribe }}>
            {children}
        </WebSocketContext.Provider>
    );
}

export function useWebSocket() {
    let ctx = useContext(WebSocketContext);
    if (!ctx) {
        throw new Error("useWebSocket must be used within WebSocketProvider");
    }
    return ctx;
}
