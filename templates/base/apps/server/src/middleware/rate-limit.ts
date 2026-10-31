import { RateLimitKey } from "./rate-limit-key";
import { Request, RequestHandler } from "express";

export { RateLimitKey } from "./rate-limit-key";

export interface RateLimitOptions {
    bucket: string;
    key: RateLimitKey | ((req: Request) => string | null | undefined);
    max: number;
    windowSeconds: number;
}

export function RATE_LIMIT(opts: RateLimitOptions): RequestHandler {
    return (req, res, next) => next();
}
