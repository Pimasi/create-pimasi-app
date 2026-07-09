import { $server } from "../services/server";

export async function loginWithFirebaseToken(token: string) {
    let { data } = await $server<string>({
        method: "post",
        url: `/auth/login-with-firebase`,
        data: {
            token,
        },
    });

    return data;
}
