import { $logger } from "../../utils/logger";
import { UserModel } from "../../models/users";
import { $sendgrid } from "../../services/sendgrid";
import { $env } from "../../utils/env";

export async function sendLoginEmail({
    user,
    url,
}: {
    user: UserModel;
    url: string;
}) {
    if (!$env.SENDGRID_API_KEY) {
        return $logger.info({ url }, "send email login url");
    }

    await $sendgrid.send({
        from: $env.SENDGRID_FROM_EMAIL,
        to: user.email,
        subject: "Log in to Pimasi Starter",
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Log in to Pimasi Starter</h2>
                <p>Hi ${user.name || "Commander"},</p>
                <p>Click the button below to log in to your account:</p>
                <p style="margin: 24px 0;">
                    <a href="${url}" style="background-color: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">
                        Log in to Pimasi Starter
                    </a>
                </p>
                <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
                <p style="color: #666; font-size: 14px;">This link will expire in 1 hour.</p>
            </div>
        `,
    });

    $logger.info("login email sent");
}
