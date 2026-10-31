import { WSEventType } from "../../values/ws-events";
import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export type WSResourceChangedEvent = Static<
    typeof WSResourceChangedEventSchema
>;
export const WSResourceChangedEventSchema = Schema.Object({
    type: Schema.Const(WSEventType.RESOURCE_CHANGED),
    resource: Schema.String(),
    id: Schema.Optional(Schema.String()),
});

export type WSNotificationEvent = Static<typeof WSNotificationEventSchema>;
export const WSNotificationEventSchema = Schema.Object({
    type: Schema.Const(WSEventType.NOTIFICATION),
    title: Schema.String(),
    body: Schema.Optional(Schema.String()),
});

export type WSEvent = Static<typeof WSEventSchema>;
export const WSEventSchema = Schema.AnyOf([
    WSResourceChangedEventSchema,
    WSNotificationEventSchema,
]);

export { WSEventType } from "../../values/ws-events";
export type WSEventByType<T extends WSEventType> = Extract<
    WSEvent,
    { type: T }
>;
