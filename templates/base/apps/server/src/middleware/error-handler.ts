import { ErrorRequestHandler } from "express";
import { $session } from "../app/session.service";
import { $logger } from "../utils/logger";
import { $alerts } from "../services/alerts";

const SENSITIVE_KEY_PATTERN =
    /password|token|secret|authorization|cookie|api[-_]?key/i;
const MAX_SANITISE_DEPTH = 6;

function sanitise(value: unknown, depth = 0): unknown {
    if (depth > MAX_SANITISE_DEPTH) {
        return "[TRUNCATED]";
    }

    if (Array.isArray(value)) {
        return value.map((entry) => sanitise(entry, depth + 1));
    }

    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => {
                if (SENSITIVE_KEY_PATTERN.test(key)) {
                    return [key, "[REDACTED]"];
                }
                return [key, sanitise(entry, depth + 1)];
            }),
        );
    }

    return value;
}

export const ERROR_HANDLER_MIDDLEWARE: ErrorRequestHandler = async (
    err,
    req,
    res,
    next,
) => {
    let code = err.statusCode ?? err.code;

    code = isNaN(code) || code >= 600 ? 500 : parseInt(code);

    let requestId = $session.getStore()?.requestId;

    let context = {
        request_url: req.url,
        request_id: requestId,
        request_headers: sanitise(req.headers),
        request_body: sanitise(req.body),
        request_params: req.params,
        request_query: sanitise(req.query),
        error: err.message,
        error_code: err.code,
        error_context: sanitise(err.context),
        error_stack: err.stack,
    };

    $logger.warn(context, "api error handler");

    if (code >= 500) {
        $alerts
            .sendMessage({
                text: "CRITICAL ERROR",
                context,
            })
            .catch($logger.error);
    }

    return res.status(code).json({
        error: err.message,
        request_id: requestId,
        context: err.context,
    });
};
