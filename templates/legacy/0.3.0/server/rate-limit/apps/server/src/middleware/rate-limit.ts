import { TooManyRequests } from "@pimasi/utils/lib/error";
import { Request, RequestHandler } from "express";
import { createHash } from "node:crypto";
import { $env } from "../utils/env";
import { $logger } from "../utils/logger";
import { $redis } from "../services/redis";
import { $jwt } from "../utils/jwt";

/**
 * Unified Redis-backed rate limiter.
 *
 * Each rate limit has a `bucket` (a stable name for the limit, used as
 * the Redis key prefix) and one keying strategy in `key`.
 *
 * Built-in strategies:
 *   - `"ip"`           — client IP (honours `x-forwarded-for`).
 *   - `"auth-token"`   — JWT in the `Authorization` header. Prefers
 *                        the decoded `user_id` so token rotation
 *                        doesn't reset the bucket; falls back to a
 *                        hash of the raw token for invalid JWTs.
 *
 * For anything else, pass a custom `(req) => string | null` resolver.
 *
 * If you need two independent caps on the same route (e.g. per-IP
 * *and* per-something-else), stack two `RATE_LIMIT(...)` middlewares
 * in the route's handler array — each runs its own counter.
 *
 * Skipped outside production so dev/test ergonomics aren't affected.
 * Set RATE_LIMIT_ENABLED=false to disable it in production too.
 */

export type RateLimitKey =
    "ip" | "auth-token" | ((req: Request) => string | null | undefined);

export interface RateLimitOptions {
    bucket: string;
    key: RateLimitKey;
    max: number;
    windowSeconds: number;
}

export function RATE_LIMIT(opts: RateLimitOptions): RequestHandler {
    let resolve = toResolver(opts.key);

    return async (req, res, next) => {
        if ($env.NODE_ENV !== "production" || !$env.RATE_LIMIT_ENABLED)
            return next();

        let fragment = resolve(req);

        if (!fragment) {
            // Nothing keyable on this request. Don't let the route run
            // unbounded — refuse rather than silently bypass.
            $logger.warn(
                { bucket: opts.bucket, url: req.url },
                "rate-limit: no key resolved",
            );
            throw TooManyRequests({ bucket: opts.bucket }, "RATE_LIMIT_NO_KEY");
        }

        let redisKey = `rate-limit:${opts.bucket}:${fragment}`;
        let count = await $redis.incr(redisKey);
        if (count === 1) await $redis.expire(redisKey, opts.windowSeconds);

        let remaining = Math.max(0, opts.max - count);
        let resetAt = new Date(
            Date.now() + opts.windowSeconds * 1000,
        ).toISOString();

        if (count > opts.max) {
            $logger.warn(
                { bucket: opts.bucket, key: redisKey, count, limit: opts.max },
                "rate limit exceeded",
            );
            throw TooManyRequests(
                {
                    limit: opts.max,
                    window_seconds: opts.windowSeconds,
                    bucket: opts.bucket,
                },
                "RATE_LIMITED",
            );
        }

        res.setHeader("X-RateLimit-Limit", String(opts.max));
        res.setHeader("X-RateLimit-Remaining", String(remaining));
        res.setHeader("X-RateLimit-Reset", resetAt);

        return next();
    };
}

function toResolver(key: RateLimitKey): (req: Request) => string | null {
    if (typeof key === "function") return (req) => key(req) ?? null;
    if (key === "ip") return clientIp;
    if (key === "auth-token") return authToken;
    return () => null;
}

function clientIp(req: Request): string | null {
    let xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
        return `ip:${xff.split(",")[0].trim()}`;
    }
    return req.ip ? `ip:${req.ip}` : null;
}

function authToken(req: Request): string | null {
    let header = req.headers["authorization"];
    if (typeof header !== "string") return null;
    let token = header.split("Bearer ").pop()?.trim();
    if (!token) return null;

    // Prefer keying on the verified user_id so a user who rotates tokens
    // (re-login, refresh) keeps hitting the same counter. Fall back to a
    // hash of the raw token for unverifiable inputs — never store the
    // raw token as a Redis key.
    try {
        let parsed = $jwt.verify(token);
        if (parsed.user_id) return `user:${parsed.user_id}`;
    } catch {}
    return `tok:${createHash("sha256").update(token).digest("hex").slice(0, 24)}`;
}
