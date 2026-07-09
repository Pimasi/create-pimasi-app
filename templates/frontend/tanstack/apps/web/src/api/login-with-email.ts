import { $server } from "../services/server";

/**
 * @deprecated not in used yet. will be used in the future
 */
export async function loginWithEmail(email: string) {
    let redirectUrl = `${window.location.origin}/login-redirect?email=${encodeURIComponent(email)}`;

    await $server({
        method: "POST",
        url: "/auth/login-with-email",
        data: {
            email,
            redirect_url: redirectUrl,
        },
    });
}
