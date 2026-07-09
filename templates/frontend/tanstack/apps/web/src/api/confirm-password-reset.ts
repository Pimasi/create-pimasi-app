import { $server } from "../services/server";
import type { ConfirmPasswordResetResponse } from "@pimasi/lib/schemas/api/auth-confirm-password-reset.schema";

export async function confirmPasswordReset(token: string, password: string) {
    let { data } = await $server<ConfirmPasswordResetResponse>({
        method: "POST",
        url: "/auth/confirm-password-reset",
        data: { token, password },
    });

    return data;
}
