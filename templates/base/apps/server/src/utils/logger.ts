import { Formatters, Logger, LoggerLevel } from "@pimasi/utils/lib/logger";
import { threadId } from "worker_threads";
import { $session } from "../app/session.service";
import { $env } from "./env";
import { jsonStringify } from "@pimasi/utils/lib/helpers";

function getProcessId() {
    return `process:${process.pid}${threadId > 0 ? ":worker:" + threadId : ""}`;
}

export const $logger = Logger({
    id: () => $session.getStore()?.requestId || getProcessId(),
    minLogLevel: LoggerLevel.DEBUG,
    formatter:
        $env.NODE_ENV !== "production" ? Formatters.Pretty : jsonStringify,
});
