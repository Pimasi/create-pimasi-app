import { Unauthorized } from "@pimasi/utils/lib/error";
import { $session } from "../../app/session.service";

export function getSessionUserOrFail() {
    let user = $session.getStore()?.user;

    if (!user) throw Unauthorized();

    return user;
}
