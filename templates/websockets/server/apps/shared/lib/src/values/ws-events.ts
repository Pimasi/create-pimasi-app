import { wireValues } from "@pimasi/lib/values/wire";

export enum WSEventType {
    RESOURCE_CHANGED = "resource_changed",
    NOTIFICATION = "notification",
}
wireValues(WSEventType, ["resource_changed", "notification"]);
