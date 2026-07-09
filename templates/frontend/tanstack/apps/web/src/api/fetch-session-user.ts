import type { SessionUserResponse } from "@pimasi/lib/schemas/api/auth-session-user.schema";
import { $server } from "../services/server";

export async function fetchSessionUser() {
    let res = await $server<SessionUserResponse>({
        method: "GET",
        url: "/auth/session-user",
    });

    return res.data;
}
