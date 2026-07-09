import { Route } from "../../app/route";
import { Schema } from "@pimasi/utils/lib/json-schema";
import { Forbidden, Unauthorized } from "@pimasi/utils/lib/error";
import { $users } from "../../models/users";
import { $firebaseAuth } from "../../services/firebase-admin";
import { hashPassword } from "../../utils/password";
import { consumePasswordResetToken } from "./password-reset-token";
import { $logger } from "../../utils/logger";
import { $env } from "../../utils/env";
import { $jwt } from "../../utils/jwt";
import {
    ConfirmPasswordResetRequestSchema,
    ConfirmPasswordResetResponseSchema,
} from "@pimasi/lib/schemas/api/auth-confirm-password-reset.schema";
import { ErrorResponseSchema } from "@pimasi/lib/schemas/api/error.schema";
import { RATE_LIMIT } from "../../middleware/rate-limit";

export const ConfirmPasswordResetRoute = Route({
    method: "post",
    route: "/auth/confirm-password-reset",
    docs: {
        tags: ["Auth"],
        description:
            "Consume a password-reset token issued by /auth/reset-password and set a new password. Returns a fresh JWT so the user is signed in immediately.",
        requestBody: {
            required: true,
            schema: ConfirmPasswordResetRequestSchema,
        },
        responses: {
            200: {
                description:
                    "Password updated; response includes JWT for the user",
                schema: ConfirmPasswordResetResponseSchema,
            },
            401: {
                description: "Invalid or expired reset token",
                schema: ErrorResponseSchema,
            },
        },
    },
    handler: [
        RATE_LIMIT({
            bucket: "confirm-pw",
            key: "ip",
            max: 10,
            windowSeconds: 60,
        }),
        async (req, res) => {
            let { token, password } = Schema.validate(
                req.body,
                ConfirmPasswordResetRequestSchema,
            );

            let userId = await consumePasswordResetToken(token);
            if (!userId) throw Unauthorized("Invalid or expired reset token");

            let user = await $users.findById(userId);
            if (!user) throw Unauthorized("Invalid or expired reset token");

            if (user.disabled_at) {
                throw Forbidden({}, "This account has been disabled.");
            }

            let passwordHash = hashPassword(password);
            await $users.update(user.id, {
                password_hash: passwordHash,
                // Successful reset proves the user controls the
                // email it was sent to.
                email_verified: true,
            });

            // Best-effort sync to Firebase. Non-fatal — the local hash is
            // authoritative for password login.
            if ($env.FIREBASE_ENABLED && user.firebase_id) {
                try {
                    await $firebaseAuth.updateUser(user.firebase_id, {
                        password,
                    });
                } catch (err) {
                    $logger.warn(
                        { err, user_id: user.id },
                        "confirm-password-reset: firebase sync failed (non-fatal)",
                    );
                }
            }

            return res.json({ success: true, token: $jwt.signUser(user) });
        },
    ],
});
