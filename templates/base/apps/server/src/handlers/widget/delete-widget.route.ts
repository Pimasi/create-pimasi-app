import { Route } from "../../app/route";
import { Schema } from "@pimasi/utils/lib/json-schema";
import { NotFound } from "@pimasi/utils/lib/error";
import { getSessionUserOrFail } from "../auth/get-session-user-or-fail";
import { $widgets } from "../../models/widgets";
import { ErrorResponseSchema } from "@pimasi/lib/schemas/api/error.schema";

export const DeleteWidgetRoute = Route({
    method: "delete",
    route: "/widgets/:id",
    docs: {
        tags: ["Widgets"],
        description: "Delete one of the authenticated user's widgets.",
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
                description: "The widget was deleted",
                schema: Schema.Object({ deleted: Schema.Boolean() }),
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

            let deleted = await $widgets.deleteForUser(id, user.id);
            if (!deleted) throw NotFound({ id }, "Widget not found");

            return res.json({ deleted: true });
        },
    ],
});
