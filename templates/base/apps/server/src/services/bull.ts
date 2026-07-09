import {
    DefaultJobOptions,
    Job,
    JobsOptions,
    Processor,
    Queue,
    Worker,
} from "bullmq";
import { $env } from "../utils/env";
import { $logger } from "../utils/logger";
import { $session } from "../app/session.service";
import { $alerts } from "./alerts";

export type AppQueue = {
    NAME: string;
    QUEUE: Queue<any>;
    add: (val: any, options?: JobsOptions) => Promise<any>;
    start: () => Promise<void>;
};

const _proto = {};
export const $bull = {
    Queue<T extends object, N extends string>(
        name: N,
        handler: (data: T, job: Job<T>) => Promise<any>,
        options: DefaultJobOptions = {},
    ) {
        let queue = new Queue<T>(name, {
            connection: {
                url: $env.REDIS_URL,
            },
            defaultJobOptions: {
                removeOnComplete: true,
                removeOnFail: {
                    age: 60 * 60 * 24 * 1, // 1 day
                },
                ...options,
            },
        });

        let worker: Worker<T> | null = null;

        let buildWorker = () => {
            let processor: Processor<T> = (job) => handler(job.data, job);

            let w = new Worker<T>(name, processor, {
                connection: {
                    url: $env.REDIS_URL,
                },
                autorun: false,
            });

            w.on("error", $logger.warn);
            w.on("failed", async (job, err) => {
                $logger.warn(err, `job failed: ${job?.name}`);
                await $alerts.sendMessage({
                    text: "JOB FAILED",
                    context: {
                        job_name: job?.name,
                        job_id: job?.id,
                        error: err.message,
                    },
                });
            });

            return w;
        };

        let instance = {
            NAME: name,
            QUEUE: queue,
            add: async (val: T, options: JobsOptions = {}) => {
                return queue.add(name as any, val as any, options);
            },
            start: async () => {
                try {
                    $logger.debug(`starting queue: ${name}`);

                    worker = worker ?? buildWorker();

                    await $session.run(
                        {
                            requestId: `worker:${name}:${process.pid}`,
                        },
                        () => worker!.run(),
                    );
                } catch (err: any) {
                    $logger.warn(err);
                    throw err;
                }
            },
        } as const;

        return Object.setPrototypeOf(instance, _proto) as typeof instance;
    },

    isValidQueue(val: any): val is AppQueue {
        return Object.getPrototypeOf(val) === _proto;
    },
};
