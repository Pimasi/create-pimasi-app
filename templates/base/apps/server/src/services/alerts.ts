import { $env } from "../utils/env";
import { $logger } from "../utils/logger";
import { $session } from "../app/session.service";
import { Formatters } from "@pimasi/utils/lib/logger";
import { http } from "@pimasi/utils/lib/http";

/** @description assumes notification url is for a discord chat webhook */
export const $alerts = {
    async sendMessage({
        text,
        context = undefined,
    }: {
        text: string;
        context?: Object;
    }) {
        try {
            let id = $session.getStore()?.requestId ?? process.pid;

            if (!$env.NOTIFICATION_URL) {
                return $logger.debug(
                    { text, context },
                    "Notification URL not configured, skipping alert",
                );
            }

            await http({
                method: "post",
                url: $env.NOTIFICATION_URL,
                data: {
                    content: `[${id}] ${text}${
                        context ? Formatters.Yml(context) : ""
                    }`,
                },
            });
        } catch (err) {
            $logger.error(err, "Failed to send alert notification");
        }
    },
};
