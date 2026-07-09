import { RequestHandler } from "express";
import { $session } from "../app/session.service";
import { ulid } from "ulid";

export const REQUEST_ID_MIDDLEWARE: RequestHandler = async (req, res, next) => {
    try {
        let requestId = (req.headers["x-request-id"] as string) || ulid();

        req.headers["x-request-id"] = requestId;
        res.set("x-request-id", requestId);

        $session.run({ requestId: requestId }, next);
    } catch (err) {
        return next(err);
    }
};
