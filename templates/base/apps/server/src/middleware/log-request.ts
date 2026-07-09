import { RequestHandler } from "express";
import { $logger } from "../utils/logger";

export const REQUEST_LOGGER_MIDDLEWARE: RequestHandler = (req, res, next) => {
    let start = performance.now();

    res.once("close", () => {
        let duration = `${(performance.now() - start).toLocaleString()}ms`;

        $logger.info(
            {
                method: req.method.toUpperCase(),
                statusCode: res.statusCode,
                url: req.path,
                duration: duration,
            },
            "request completed",
        );
    });

    next();
};
