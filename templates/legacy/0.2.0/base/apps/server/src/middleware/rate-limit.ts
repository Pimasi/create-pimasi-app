import { Request, RequestHandler } from "express";

export type RateLimitKey =
    "ip" | "auth-token" | ((req: Request) => string | null | undefined);

export interface RateLimitOptions {
    bucket: string;
    key: RateLimitKey;
    max: number;
    windowSeconds: number;
}

export function RATE_LIMIT(opts: RateLimitOptions): RequestHandler {
    return (req, res, next) => next();
}
