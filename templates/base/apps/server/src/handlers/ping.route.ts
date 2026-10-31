import { Route } from "../app/route";
import { PingResponseSchema } from "@pimasi/lib/schemas/api/ping-response.schema";
import { $env } from "../utils/env";

export const PingRoute = Route({
    method: "get",
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
                message: "pong",
                version: $env.APP_VERSION,
                commit: $env.GIT_SHA,
            });
        },
    ],
});
