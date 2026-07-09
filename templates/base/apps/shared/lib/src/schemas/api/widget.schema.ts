import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export type Widget = Static<typeof WidgetSchema>;
export const WidgetSchema = Schema.Object({
    id: Schema.String(),
    name: Schema.String(),
    description: Schema.Nullable(Schema.String()),
    quantity: Schema.Number(),
    created_at: Schema.String(),
    updated_at: Schema.String(),
});

export type CreateWidgetRequest = Static<typeof CreateWidgetRequestSchema>;
export const CreateWidgetRequestSchema = Schema.Object({
    name: Schema.String({ minLength: 1 }),
    description: Schema.Optional(Schema.Nullable(Schema.String())),
    quantity: Schema.Optional(Schema.Number({ minimum: 0 })),
});

export type UpdateWidgetRequest = Static<typeof UpdateWidgetRequestSchema>;
export const UpdateWidgetRequestSchema = Schema.Object({
    name: Schema.Optional(Schema.String({ minLength: 1 })),
    description: Schema.Optional(Schema.Nullable(Schema.String())),
    quantity: Schema.Optional(Schema.Number({ minimum: 0 })),
});

export const WidgetListResponseSchema = Schema.Array(WidgetSchema);
