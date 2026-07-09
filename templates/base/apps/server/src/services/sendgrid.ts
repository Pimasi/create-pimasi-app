import SendgridClient from "@sendgrid/mail";
import { $env } from "../utils/env";

if ($env.SENDGRID_API_KEY) {
    SendgridClient.setApiKey($env.SENDGRID_API_KEY);
}

export const $sendgrid = SendgridClient;
