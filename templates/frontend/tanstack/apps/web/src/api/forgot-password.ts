import { $server } from "../services/server";

export async function forgotPassword(email: string) {
    let { data } = await $server({
        method: "POST",
        url: "/auth/reset-password",
        data: { email },
    });

    return data;
}
