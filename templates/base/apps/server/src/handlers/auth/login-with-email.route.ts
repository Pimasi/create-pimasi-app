import { Route } from "../../app/route";
import { BadRequest, Forbidden, Unauthorized } from "@pimasi/utils/lib/error";
import { $sendLoginEmailQueue } from "./send-login-email.queue";
import { LoginWithEmailRequestSchema } from "@pimasi/lib/schemas/api/auth-login-email.schema";
import {
    getFirebaseAuthorizedDomains,
    isUrlOnAuthorizedDomain,
} from "../../services/firebase-admin";
import { Schema } from "@pimasi/utils/lib/json-schema";
import { RATE_LIMIT } from "../../middleware/rate-limit";
import { normaliseEmail } from "../../models/users";

export const LoginWithEmailRoute = Route({
    method: "post",
    route: "/auth/login-with-email",
    docs: {
        tags: ["Auth"],
        description:
            "Send a passwordless login email with a magic link. Returns 204 immediately.",
        requestBody: {
            required: true,
            schema: LoginWithEmailRequestSchema,
        },
        responses: {
            204: {
                description: "Email queued for delivery",
                schema: {},
            },
        },
    },
    handler: [
        RATE_LIMIT({
            bucket: "login-email",
            key: (req) =>
                typeof req.body?.email === "string"
                    ? `email:${normaliseEmail(req.body.email)}`
                    : null,
            max: 5,
            windowSeconds: 5 * 60,
        }),
        async (req, res) => {
            let { email, redirect_url: redirectUrl } = Schema.validate(
                req.body,
                LoginWithEmailRequestSchema,
            );

            let authorizedDomains = await getFirebaseAuthorizedDomains();
            if (!isUrlOnAuthorizedDomain(redirectUrl, authorizedDomains)) {
                throw Forbidden("redirect_url is not on an authorized domain");
            }

            await $sendLoginEmailQueue.add({
                email,
                redirect_url: redirectUrl,
            });

            return res.status(204).json();
        },
    ],
});
