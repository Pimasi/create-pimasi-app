import { $logger } from "../../utils/logger";
import { UserModel } from "../../models/users";
import { $sendgrid } from "../../services/sendgrid";
import { $env } from "../../utils/env";

export async function sendResetPasswordEmail({
    user,
    url,
}: {
    user: UserModel;
    url: string;
}) {
    if (!$env.SENDGRID_API_KEY) {
        return $logger.info({ url }, "send reset password url");
    }

    await $sendgrid.send({
        from: $env.SENDGRID_FROM_EMAIL,
        to: user.email,
        subject: "Reset your Pimasi Starter password",
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Reset your password</h2>
                <p>Hi ${user.name || "Commander"},</p>
                <p>We received a request to reset your Pimasi Starter password. Click the button below to set a new password:</p>
                <p style="margin: 24px 0;">
                    <a href="${url}" style="background-color: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">
                        Reset Password
                    </a>
                </p>
                <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email. Your password will remain unchanged.</p>
                <p style="color: #666; font-size: 14px;">This link will expire in 1 hour.</p>
            </div>
        `,
    });

    $logger.info("reset password email sent");
}
