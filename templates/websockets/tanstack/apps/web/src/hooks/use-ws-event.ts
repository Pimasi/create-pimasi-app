import { useEffect, useRef } from "react";
import type {
    WSEventByType,
    WSEventType,
} from "@pimasi/lib/schemas/api/ws-events.schema";
import { useWebSocket } from "./use-websocket";

export function useWSEvent<T extends WSEventType>(
    type: T,
    handler: (event: WSEventByType<T>) => void,
): void {
    let { subscribe } = useWebSocket();
    let handlerRef = useRef(handler);
    handlerRef.current = handler;

    useEffect(() => {
        return subscribe(type, (event) => handlerRef.current(event));
    }, [subscribe, type]);
}
