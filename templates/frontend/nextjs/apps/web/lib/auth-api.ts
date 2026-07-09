import { $server } from "./server";
import type { SessionUserResponse } from "@pimasi/lib/schemas/api/auth-session-user.schema";
import type { ConfirmPasswordResetResponse } from "@pimasi/lib/schemas/api/auth-confirm-password-reset.schema";

export async function fetchSessionUser() {
    let { data } = await $server<SessionUserResponse>({
        method: "GET",
        url: "/auth/session-user",
    });
    return data;
}

export async function loginWithPassword(email: string, password: string) {
    let { data } = await $server<string>({
        method: "POST",
        url: "/auth/login-with-password",
        data: { email, password },
    });
    return data;
}

export async function register(email: string, password: string) {
    let { data } = await $server<string>({
        method: "POST",
        url: "/auth/register",
        data: { email, password },
    });
    return data;
}

export async function loginWithFirebaseToken(token: string) {
    let { data } = await $server<string>({
        method: "POST",
        url: "/auth/login-with-firebase",
        data: { token },
    });
    return data;
}

export async function forgotPassword(email: string) {
    let { data } = await $server({
        method: "POST",
        url: "/auth/reset-password",
        data: { email },
    });
    return data;
}

export async function confirmPasswordReset(token: string, password: string) {
    let { data } = await $server<ConfirmPasswordResetResponse>({
        method: "POST",
        url: "/auth/confirm-password-reset",
        data: { token, password },
    });
    return data;
}

export async function setPassword(password: string) {
    let { data } = await $server({
        method: "POST",
        url: "/auth/set-password",
        data: { password },
    });
    return data;
}
