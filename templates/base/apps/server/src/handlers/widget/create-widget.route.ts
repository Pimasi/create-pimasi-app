import { Route } from "../../app/route";
import { Schema } from "@pimasi/utils/lib/json-schema";
import { ulid } from "ulid";
import { getSessionUserOrFail } from "../auth/get-session-user-or-fail";
import { $widgets, toWidgetResponse, WidgetModel } from "../../models/widgets";
import {
    CreateWidgetRequestSchema,
    WidgetSchema,
} from "@pimasi/lib/schemas/api/widget.schema";
import { ErrorResponseSchema } from "@pimasi/lib/schemas/api/error.schema";

export const CreateWidgetRoute = Route({
    method: "post",
    route: "/widgets",
    docs: {
        tags: ["Widgets"],
        description: "Create a widget owned by the authenticated user.",
        security: true,
        requestBody: {
            required: true,
            schema: CreateWidgetRequestSchema,
        },
        responses: {
            200: {
                description: "The created widget",
                schema: WidgetSchema,
            },
            400: {
                description: "Invalid request body",
                schema: ErrorResponseSchema,
            },
        },
    },
    handler: [
        async (req, res) => {
            let user = getSessionUserOrFail();
            let body = Schema.validate(req.body, CreateWidgetRequestSchema);

            let now = new Date();
            let widget: WidgetModel = {
                id: ulid(),
                user_id: user.id,
                name: body.name,
                description: body.description ?? null,
                quantity: body.quantity ?? 0,
                created_at: now,
                updated_at: now,
            };

            await $widgets.insert(widget);

            return res.json(toWidgetResponse(widget));
        },
    ],
});
