import { Route } from "../../app/route";
import { getSessionUserOrFail } from "../auth/get-session-user-or-fail";
import { $widgets, toWidgetResponse } from "../../models/widgets";
import { WidgetListResponseSchema } from "@pimasi/lib/schemas/api/widget.schema";

export const ListWidgetsRoute = Route({
    method: "get",
    route: "/widgets",
    docs: {
        tags: ["Widgets"],
        description: "List the authenticated user's widgets, newest first.",
        security: true,
        responses: {
            200: {
                description: "The caller's widgets",
                schema: WidgetListResponseSchema,
            },
        },
    },
    handler: [
        async (req, res) => {
            let user = getSessionUserOrFail();

            let widgets = await $widgets.listByUser(user.id);

            return res.json(widgets.map(toWidgetResponse));
        },
    ],
});
