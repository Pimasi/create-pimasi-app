import { ExpressAdapter } from "@bull-board/express";
import { $bull, AppQueue } from "../services/bull";
import { resolve } from "path";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { globSync } from "fs";
import { $logger } from "../utils/logger";

export function AppQueues() {
    let files = globSync(resolve(__dirname, "../**/*.queue.*"));

    let queues: AppQueue[] = [];
    files.forEach((path) => {
        try {
            let module = require(path);

            Object.entries(module).forEach(([name, queue]: [string, any]) => {
                if ($bull.isValidQueue(queue)) {
                    queues.push(queue);
                }
            });
        } catch (err) {
            $logger.warn(err, `failed to load queue module: ${path}`);
        }
    });

    return queues;
}

export async function QueueMonitor() {
    let adapter = new ExpressAdapter();

    adapter.setBasePath("/bull");

    let monitor = createBullBoard({
        queues: AppQueues().map((queue) => new BullMQAdapter(queue.QUEUE)),
        serverAdapter: adapter,
    });

    return {
        adapter,
        monitor,
    };
}
