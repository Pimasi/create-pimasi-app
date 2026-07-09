import { Route } from "../../app/route";
import { NotFound } from "@pimasi/utils/lib/error";
import { getSessionUserOrFail } from "../auth/get-session-user-or-fail";
import { $widgets, toWidgetResponse } from "../../models/widgets";
import { WidgetSchema } from "@pimasi/lib/schemas/api/widget.schema";
import { ErrorResponseSchema } from "@pimasi/lib/schemas/api/error.schema";

export const GetWidgetRoute = Route({
    method: "get",
    route: "/widgets/:id",
    docs: {
        tags: ["Widgets"],
        description: "Get one of the authenticated user's widgets by id.",
        security: true,
        parameters: [
            {
                in: "path",
                name: "id",
                required: true,
                schema: { type: "string" },
            },
        ],
        responses: {
            200: {
                description: "The widget",
                schema: WidgetSchema,
            },
            404: {
                description: "Widget not found",
                schema: ErrorResponseSchema,
            },
        },
    },
    handler: [
        async (req, res) => {
            let user = getSessionUserOrFail();
            let id = req.params.id as string;

            let widget = await $widgets.findByIdForUser(id, user.id);
            if (!widget) throw NotFound({ id }, "Widget not found");

            return res.json(toWidgetResponse(widget));
        },
    ],
});
