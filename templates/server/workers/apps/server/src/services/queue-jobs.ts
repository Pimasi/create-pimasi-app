import type { AppQueue } from "./bull";

/**
 * Reschedule a delayed completion job to fire `delayMs` from now. BullMQ
 * keys jobs by id, and `add` is a no-op when a job with the same id already
 * exists — so we fetch the existing job and `changeDelay` it, falling back to
 * a fresh `add` when it is gone (e.g. already processed/removed).
 */
export async function rescheduleQueueJob(
    queue: AppQueue,
    jobId: string,
    data: unknown,
    delayMs: number,
): Promise<void> {
    let job = await queue.QUEUE.getJob(jobId);
    if (job) {
        try {
            await job.changeDelay(Math.max(0, delayMs));
            return;
        } catch {
            // Fall through to a fresh add (job may have moved out of delayed).
        }
    }
    await queue.add(data, { delay: Math.max(0, delayMs), jobId });
}

/** Best-effort removal of a delayed completion job by id. */
export async function removeQueueJob(
    queue: AppQueue,
    jobId: string,
): Promise<void> {
    try {
        let job = await queue.QUEUE.getJob(jobId);
        if (job) await job.remove();
    } catch {
        // Ignore — a job that is mid-process or already gone is harmless; the
        // lazy `processCompleted*` drain is the source of truth.
    }
}
