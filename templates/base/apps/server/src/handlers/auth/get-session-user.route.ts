import { Route } from "../../app/route";
import { getSessionUserOrFail } from "./get-session-user-or-fail";
import { $users } from "../../models/users";
import { SessionUserResponseSchema } from "@pimasi/lib/schemas/api/auth-session-user.schema";

export const GetSessionUserRoute = Route({
    method: "get",
    route: `/auth/session-user`,
    docs: {
        tags: ["Auth"],
        description: "Get the currently authenticated user's profile.",
        security: true,
        responses: {
            200: {
                description: "The authenticated user",
                schema: SessionUserResponseSchema,
            },
        },
    },
    handler: [
        async (req, res) => {
            let user = getSessionUserOrFail();

            // password_hash is stripped from session.user by
            // parse-session.middleware. Re-fetch and surface it (or "" when
            // unset) so the FE can branch between initial-set and
            // change-password flows.
            let stored = await $users.findById(user.id);

            return res.json({
                id: user.id,
                name: user.name,
                email: user.email,
                email_verified: user.email_verified,
                password: stored?.password_hash ?? "",
                firebase_id: user.firebase_id ?? null,
                roles: user.roles,
            });
        },
    ],
});
