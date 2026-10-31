import { $users, normaliseEmail } from "../../models/users";
import { $firebaseAuth } from "../../services/firebase-admin";
import { issuePasswordResetToken } from "../auth/password-reset-token";
import { sendLoginEmail } from "./login-email";
import { sendResetPasswordEmail } from "./reset-password-email";

export async function dispatchLoginEmail({
    email,
    redirect_url: redirectUrl,
}: {
    email: string;
    redirect_url: string;
}): Promise<void> {
    let user = await $users.findByEmail(email);

    if (!user) return;

    let url = await $firebaseAuth.generateSignInWithEmailLink(user.email, {
        url: redirectUrl,
        handleCodeInApp: true,
    });

    await sendLoginEmail({ url, user });
}

export async function dispatchResetPasswordEmail({
    email,
    frontend_origin: frontendOrigin,
}: {
    email: string;
    frontend_origin: string;
}): Promise<void> {
    let user = await $users.findByEmail(normaliseEmail(email));

    // Silently no-op for unknown emails so that the public endpoint
    // does not leak account existence.
    if (!user) return;
    if (user.disabled_at) return;

    let token = await issuePasswordResetToken(user.id);
    let url = `${frontendOrigin}/reset-password?token=${encodeURIComponent(token)}`;

    await sendResetPasswordEmail({ url, user });
}
