import type { ReadyResponse } from "@pimasi/lib/schemas/api/ready-response.schema";
import { $logger } from "../utils/logger";

const CHECKS = new Map<string, () => Promise<void>>();
const CHECK_TIMEOUT_MS = 2_000;

export function registerReadinessCheck(
    name: string,
    check: () => Promise<void>,
): () => void {
    let previous = CHECKS.get(name);
    CHECKS.set(name, check);
    return () => {
        if (CHECKS.get(name) !== check) return;
        if (previous) CHECKS.set(name, previous);
        else CHECKS.delete(name);
    };
}

export async function runReadinessChecks(): Promise<ReadyResponse> {
    let results = await Promise.all(
        [...CHECKS].map(async ([name, check]) => {
            let timeout: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([
                    Promise.resolve().then(check),
                    new Promise<never>((resolve, reject) => {
                        timeout = setTimeout(() => {
                            reject(new Error("readiness check timed out"));
                        }, CHECK_TIMEOUT_MS);
                    }),
                ]);
                return [name, "ok"] as const;
            } catch (err) {
                $logger.error({ name, err }, "readiness check failed");
                return [name, "failed"] as const;
            } finally {
                clearTimeout(timeout);
            }
        }),
    );
    let checks = Object.fromEntries(results);
    return {
        status: results.every(([, result]) => result === "ok")
            ? "ready"
            : "unavailable",
        checks,
    };
}
