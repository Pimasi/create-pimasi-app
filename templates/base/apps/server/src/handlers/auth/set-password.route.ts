import { Route } from "../../app/route";
import { BadRequest, Unauthorized } from "@pimasi/utils/lib/error";
import { getSessionUserOrFail } from "./get-session-user-or-fail";
import { $firebaseAuth } from "../../services/firebase-admin";
import { $users } from "../../models/users";
import { hashPassword, verifyPassword } from "../../utils/password";
import { $logger } from "../../utils/logger";
import { $env } from "../../utils/env";
import {
    SetPasswordRequestSchema,
    SetPasswordResponseSchema,
} from "@pimasi/lib/schemas/api/auth-set-password.schema";
import { ErrorResponseSchema } from "@pimasi/lib/schemas/api/error.schema";
import { Schema } from "@pimasi/utils/lib/json-schema";

export const SetPasswordRoute = Route({
    method: "post",
    route: `/auth/set-password`,
    docs: {
        tags: ["Auth"],
        description:
            "Set or update the user's password. Writes a local hash and best-effort syncs to Firebase so email-link/Google flows continue to work for the same identity.",
        security: true,
        requestBody: {
            required: true,
            schema: SetPasswordRequestSchema,
        },
        responses: {
            200: {
                description: "Password updated successfully",
                schema: SetPasswordResponseSchema,
            },
            400: {
                description: "Invalid password (must be at least 6 characters)",
                schema: ErrorResponseSchema,
            },
        },
    },
    handler: [
        async (req, res) => {
            let user = getSessionUserOrFail();
            let { password, current_password: currentPassword } =
                Schema.validate(req.body, SetPasswordRequestSchema);

            // Re-fetch the stored hash: when one exists, the caller must
            // prove possession of the current password. Google-only accounts
            // (no hash yet) skip this check — that's the initial-set flow.
            let stored = await $users.findById(user.id);
            if (stored?.password_hash) {
                if (!currentPassword) {
                    throw BadRequest({}, "Current password is required");
                }
                if (!verifyPassword(currentPassword, stored.password_hash)) {
                    throw Unauthorized({}, "Current password is incorrect");
                }
            }

            let passwordHash = hashPassword(password);
            await $users.update(user.id, { password_hash: passwordHash });

            // Best-effort sync to Firebase so a user who later signs in via
            // email-link or any other Firebase-backed surface uses the same
            // password. Failure here is non-fatal: the local hash is the
            // source of truth.
            if ($env.FIREBASE_ENABLED && user.firebase_id) {
                try {
                    await $firebaseAuth.updateUser(user.firebase_id, {
                        password,
                    });
                } catch (err) {
                    $logger.warn(
                        { err, user_id: user.id },
                        "set-password: firebase sync failed (non-fatal)",
                    );
                }
            }

            return res.json({ success: true });
        },
    ],
});
