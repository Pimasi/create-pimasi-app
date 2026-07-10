import { $sendLoginEmailQueue } from "../auth/send-login-email.queue";
import { $sendResetPasswordEmailQueue } from "../auth/send-reset-password-email.queue";

export async function dispatchLoginEmail(payload: {
    email: string;
    redirect_url: string;
}): Promise<void> {
    await $sendLoginEmailQueue.add(payload);
}

export async function dispatchResetPasswordEmail(payload: {
    email: string;
    frontend_origin: string;
}): Promise<void> {
    await $sendResetPasswordEmailQueue.add(payload);
}
