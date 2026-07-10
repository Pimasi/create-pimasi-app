import { $logger } from "./utils/logger";
import { AppQueues } from "./app/queues";
import { $session } from "./app/session.service";

$session.run(
    { requestId: `queue-worker:${process.pid.toString().padStart(4, "0")}` },
    async () => {
        let queues = await AppQueues();

        await Promise.all(queues.map((queue) => queue.start()));

        $logger.info(`queue workers running`);
    },
);
