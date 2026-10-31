import { PingMessage } from "@pimasi/lib/values/health";
import { RouteMethod } from "../app/route-values";
import { Route } from "../app/route";
import { PingResponseSchema } from "@pimasi/lib/schemas/api/ping-response.schema";
import { $env } from "../utils/env";

export const PingRoute = Route({
    method: RouteMethod.GET,
    route: "/ping",
    docs: {
        tags: ["Health"],
        description: "Health check endpoint.",
        responses: {
            200: {
                description: "Server is alive",
                schema: PingResponseSchema,
            },
        },
    },
    handler: [
        async (req, res) => {
            res.status(200).json({
                message: PingMessage.PONG,
                version: $env.APP_VERSION,
                commit: $env.GIT_SHA,
            });
        },
    ],
});
