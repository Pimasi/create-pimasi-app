import { RequestHandler } from "express";
import { $logger } from "../../utils/logger";
import { $jwt } from "../../utils/jwt";
import { $users } from "../../models/users";
import { $session } from "../../app/session.service";

/**
 * Parse the incoming JWT and populate the ALS session with the user it
 * identifies. Always non-throwing: bad/missing tokens just leave the session
 * empty, and downstream guards (`getSessionUserOrFail`) decide whether that's
 * a problem.
 */
export const PARSE_SESSION_MIDDLEWARE: RequestHandler = async (
    req,
    res,
    next,
) => {
    let token = req.headers["authorization"]?.split("Bearer ")?.pop()?.trim();

    if (!token) {
        $logger.debug("auth token not set, skipping session parsing");
        return next();
    }

    try {
        let parsed = $jwt.verify(token);

        if (!parsed.user_id) return next();

        let user = await $users.findById(parsed.user_id);
        if (!user) return next();

        delete (user as any).password_hash;

        let session = $session.getStore() ?? {};

        return $session.run({ ...session, user }, next);
    } catch (err: any) {
        // Never log the raw token — it is a bearer credential (and may be a
        // short-lived impersonation token). The error message is enough.
        $logger.warn({ err }, err.message);
        return next();
    }
};
