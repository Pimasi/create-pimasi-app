import { RequestHandler } from "express";
import { getSessionUserOrFail } from "./get-session-user-or-fail";
import { UserRoles } from "@pimasi/lib/values/auth";
import { Unauthorized } from "@pimasi/utils/lib/error";

export const HAS_ROLES: (permissions: UserRoles[]) => RequestHandler = (
    permissions,
) => {
    return async (req, res, next) => {
        let user = getSessionUserOrFail();

        let isAuthorised = !permissions.length
            ? true
            : [UserRoles.ADMIN, ...permissions].some((permission) => {
                  return user.roles.includes(permission);
              });

        if (!isAuthorised) throw Unauthorized();

        return next();
    };
};
