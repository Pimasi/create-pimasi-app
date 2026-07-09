import { Route } from "../../app/route";
import { Schema } from "@pimasi/utils/lib/json-schema";
import { NotFound } from "@pimasi/utils/lib/error";
import { getSessionUserOrFail } from "../auth/get-session-user-or-fail";
import { $widgets, toWidgetResponse, WidgetUpdate } from "../../models/widgets";
import {
    UpdateWidgetRequestSchema,
    WidgetSchema,
} from "@pimasi/lib/schemas/api/widget.schema";
import { ErrorResponseSchema } from "@pimasi/lib/schemas/api/error.schema";

export const UpdateWidgetRoute = Route({
    method: "patch",
    route: "/widgets/:id",
    docs: {
        tags: ["Widgets"],
        description: "Update one of the authenticated user's widgets.",
        security: true,
        parameters: [
            {
                in: "path",
                name: "id",
                required: true,
                schema: { type: "string" },
            },
        ],
        requestBody: {
            required: true,
            schema: UpdateWidgetRequestSchema,
        },
        responses: {
            200: {
                description: "The updated widget",
                schema: WidgetSchema,
            },
            400: {
                description: "Invalid request body",
                schema: ErrorResponseSchema,
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
            let body = Schema.validate(req.body, UpdateWidgetRequestSchema);

            let updates: WidgetUpdate = { updated_at: new Date() };
            if (body.name !== undefined) updates.name = body.name;
            if (body.description !== undefined) {
                updates.description = body.description;
            }
            if (body.quantity !== undefined) updates.quantity = body.quantity;

            let widget = await $widgets.updateForUser(id, user.id, updates);

            if (!widget) throw NotFound({ id }, "Widget not found");

            return res.json(toWidgetResponse(widget));
        },
    ],
});
