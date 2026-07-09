import { Request } from "express";
import { BadRequest } from "@pimasi/utils/lib/error";

/**
 * Resolve the frontend origin (scheme + host[:port], no trailing slash)
 * for the request that triggered an outbound user-facing link — e.g. the
 * URL embedded in a password-reset email.
 *
 * Resolution order:
 *   1. `X-Frontend-Origin` header. Used by Cordova builds, where the
 *      WebView's real `Origin` is `file://` or a custom scheme that's
 *      not usable as a public URL. The Cordova build is responsible
 *      for setting this header to the production web URL of the game.
 *   2. The browser-set `Origin` header.
 *   3. The origin parsed out of `Referer`.
 *
 * Anything that isn't a valid `http://` or `https://` origin is rejected
 * and the request is failed with 400, so we never email a user a link
 * pointing at `file://` or `null`.
 */
export function getRequestOrigin(req: Request): string {
    let candidates = [
        firstHeaderValue(req, "x-frontend-origin"),
        firstHeaderValue(req, "origin"),
        originFromReferer(firstHeaderValue(req, "referer")),
    ];

    for (let candidate of candidates) {
        let normalized = toHttpOrigin(candidate);
        if (normalized) return normalized;
    }

    throw BadRequest(
        {},
        "Cannot determine the frontend origin for this request. Send an " +
            "X-Frontend-Origin header with a valid https:// URL.",
    );
}

function firstHeaderValue(req: Request, name: string): string | null {
    let raw = req.headers[name];
    if (Array.isArray(raw)) return raw[0] ?? null;
    return typeof raw === "string" ? raw : null;
}

function originFromReferer(referer: string | null): string | null {
    if (!referer) return null;
    try {
        let parsed = new URL(referer);
        return parsed.origin;
    } catch {
        return null;
    }
}

function toHttpOrigin(value: string | null): string | null {
    if (!value) return null;
    let trimmed = value.trim();
    if (!trimmed) return null;
    try {
        let parsed = new URL(trimmed);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }
        return parsed.origin;
    } catch {
        return null;
    }
}
