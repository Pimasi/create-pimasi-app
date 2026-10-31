import { wireValues } from "@pimasi/lib/values/wire";

export enum PingMessage {
    PONG = "pong",
}
wireValues(PingMessage, ["pong"]);

export enum ReadinessStatus {
    READY = "ready",
    UNAVAILABLE = "unavailable",
}
wireValues(ReadinessStatus, ["ready", "unavailable"]);

export enum ReadinessCheckStatus {
    OK = "ok",
    FAILED = "failed",
}
wireValues(ReadinessCheckStatus, ["ok", "failed"]);
