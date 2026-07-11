import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export type WSResourceChangedEvent = Static<
    typeof WSResourceChangedEventSchema
>;
export const WSResourceChangedEventSchema = Schema.Object({
    type: Schema.Const("resource_changed"),
    resource: Schema.String(),
    id: Schema.Optional(Schema.String()),
});

export type WSNotificationEvent = Static<typeof WSNotificationEventSchema>;
export const WSNotificationEventSchema = Schema.Object({
    type: Schema.Const("notification"),
    title: Schema.String(),
    body: Schema.Optional(Schema.String()),
});

export type WSEvent = Static<typeof WSEventSchema>;
export const WSEventSchema = Schema.AnyOf([
    WSResourceChangedEventSchema,
    WSNotificationEventSchema,
]);

export type WSEventType = WSEvent["type"];
export type WSEventByType<T extends WSEventType> = Extract<
    WSEvent,
    { type: T }
>;
