import { $server } from "../services/server";

export async function loginWithPassword(email: string, password: string) {
    let { data } = await $server<string>({
        method: "post",
        url: `/auth/login-with-password`,
        data: {
            email,
            password,
        },
    });

    return data;
}
