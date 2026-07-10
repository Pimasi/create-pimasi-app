import { Route } from "../../app/route";
import { Schema } from "@pimasi/utils/lib/json-schema";
import { dispatchResetPasswordEmail } from "../email/dispatch";
import { ResetPasswordRequestSchema } from "@pimasi/lib/schemas/api/auth-reset-password.schema";
import { normaliseEmail } from "../../models/users";
import { RATE_LIMIT } from "../../middleware/rate-limit";
import { getRequestOrigin } from "../../utils/request-origin";

export const ResetPasswordRoute = Route({
    method: "post",
    route: "/auth/reset-password",
    docs: {
        tags: ["Auth"],
        description:
            "Send a password reset email. Returns 204 immediately regardless of whether the email exists.",
        requestBody: {
            required: true,
            schema: ResetPasswordRequestSchema,
        },
        responses: {
            204: {
                description: "Reset email queued for delivery",
                schema: {},
            },
        },
    },
    handler: [
        RATE_LIMIT({
            bucket: "reset-pw",
            key: (req) =>
                typeof req.body?.email === "string"
                    ? `email:${normaliseEmail(req.body.email)}`
                    : null,
            max: 3,
            windowSeconds: 5 * 60,
        }),
        async (req, res) => {
            let { email } = Schema.validate(
                req.body,
                ResetPasswordRequestSchema,
            );

            let frontendOrigin = getRequestOrigin(req);

            await dispatchResetPasswordEmail({
                email: normaliseEmail(email),
                frontend_origin: frontendOrigin,
            });

            return res.status(204).json();
        },
    ],
});
