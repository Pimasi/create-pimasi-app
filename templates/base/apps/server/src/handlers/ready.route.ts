import { ReadinessStatus } from "@pimasi/lib/values/health";
import { RouteMethod } from "../app/route-values";
import { ReadyResponseSchema } from "@pimasi/lib/schemas/api/ready-response.schema";
import { Route } from "../app/route";
import { runReadinessChecks } from "../app/readiness";

export const ReadyRoute = Route({
    method: RouteMethod.GET,
    route: "/ready",
    docs: {
        tags: ["Health"],
        description: "Dependency readiness endpoint.",
        responses: {
            200: {
                description: "Every registered dependency is ready",
                schema: ReadyResponseSchema,
            },
            503: {
                description: "A registered dependency is unavailable",
                schema: ReadyResponseSchema,
            },
        },
    },
    handler: [
        async (req, res) => {
            let result = await runReadinessChecks();
            res.status(
                result.status === ReadinessStatus.READY ? 200 : 503,
            ).json(result);
        },
    ],
});
