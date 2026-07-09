import { $bull } from "../../services/bull";
import { $logger } from "../../utils/logger";
import { $users, normaliseEmail } from "../../models/users";
import { sendResetPasswordEmail } from "../email/reset-password-email";
import { issuePasswordResetToken } from "./password-reset-token";

interface SendResetPasswordEmailJob {
    email: string;
    /**
     * Frontend origin (scheme + host[:port]) that the reset link should
     * point at, captured from the originating request via
     * `getFrontendOrigin()`. Must be an http:// or https:// origin with
     * no trailing slash.
     */
    frontend_origin: string;
}

export const $sendResetPasswordEmailQueue = $bull.Queue(
    "send-reset-password-email",
    async ({
        email,
        frontend_origin: frontendOrigin,
    }: SendResetPasswordEmailJob) => {
        try {
            let user = await $users.findByEmail(normaliseEmail(email));

            // Silently no-op for unknown emails so that the public endpoint
            // does not leak account existence.
            if (!user) return;
            if (user.disabled_at) return;

            let token = await issuePasswordResetToken(user.id);
            let url = `${frontendOrigin}/reset-password?token=${encodeURIComponent(token)}`;

            await sendResetPasswordEmail({ url, user });

            $logger.info({ user_id: user.id }, "reset password email sent");
        } catch (err) {
            $logger.warn(err);
            throw err;
        }
    },
);
