import { Widget } from "@pimasi/lib/schemas/api/widget.schema";
import { widgetsRepo } from "./widgets.impl";

export interface WidgetModel {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    quantity: number;
    created_at: Date;
    updated_at: Date;
}

export interface WidgetUpdate {
    name?: string;
    description?: string | null;
    quantity?: number;
    updated_at: Date;
}

export interface WidgetsRepo {
    listByUser(userId: string): Promise<WidgetModel[]>;
    findByIdForUser(id: string, userId: string): Promise<WidgetModel | null>;
    insert(widget: WidgetModel): Promise<void>;
    updateForUser(
        id: string,
        userId: string,
        changes: WidgetUpdate,
    ): Promise<WidgetModel | null>;
    deleteForUser(id: string, userId: string): Promise<boolean>;
}

export const $widgets: WidgetsRepo = widgetsRepo;

export function toWidgetResponse(model: WidgetModel): Widget {
    return {
        id: model.id,
        name: model.name,
        description: model.description,
        quantity: model.quantity,
        created_at: model.created_at.toISOString(),
        updated_at: model.updated_at.toISOString(),
    };
}
