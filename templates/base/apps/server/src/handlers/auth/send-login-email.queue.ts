import { $bull } from "../../services/bull";
import { $logger } from "../../utils/logger";
import { $users } from "../../models/users";
import { $firebaseAuth } from "../../services/firebase-admin";
import { sendLoginEmail } from "../email/login-email";

interface SendLoginEmailJob {
    email: string;
    redirect_url: string;
}

export const $sendLoginEmailQueue = $bull.Queue(
    "send-login-email",
    async ({ email, redirect_url: redirectUrl }: SendLoginEmailJob) => {
        try {
            let user = await $users.findByEmail(email);

            if (!user) return;

            let url = await $firebaseAuth.generateSignInWithEmailLink(
                user.email,
                {
                    url: redirectUrl,
                    handleCodeInApp: true,
                },
            );

            await sendLoginEmail({ url, user });

            $logger.info("login email sent");
        } catch (err) {
            $logger.warn(err);
            throw err;
        }
    },
);
