import { $server } from "../services/server";

export async function register(email: string, password: string) {
    let { data } = await $server<string>({
        method: "POST",
        url: "/auth/register",
        data: { email, password },
    });

    return data;
}
