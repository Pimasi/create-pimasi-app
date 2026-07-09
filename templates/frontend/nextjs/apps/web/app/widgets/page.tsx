"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WithCredentials } from "@/components/with-credentials";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { createWidget, deleteWidget, useWidgets } from "@/hooks/use-widgets";
import { errorMessage } from "@/lib/errors";
import type { Widget } from "@pimasi/lib/schemas/api/widget.schema";

export default function WidgetsPage() {
    let router = useRouter();

    let onUnauthenticated = useCallback(() => {
        router.replace("/login");
    }, [router]);

    useDocumentTitle("Widgets");

    return (
        <WithCredentials onUnauthenticated={onUnauthenticated}>
            <WidgetsContent />
        </WithCredentials>
    );
}

function WidgetsContent() {
    let widgets = useWidgets();
    let mutate = widgets.mutate;

    let [name, setName] = useState("");
    let [quantity, setQuantity] = useState("");
    let [error, setError] = useState<string | null>(null);
    let [creating, setCreating] = useState(false);

    let handleCreate = useCallback(
        async (e: React.FormEvent) => {
            e.preventDefault();
            setError(null);
            setCreating(true);
            try {
                let trimmed = quantity.trim();
                await createWidget({
                    name: name.trim(),
                    quantity: trimmed === "" ? undefined : Number(trimmed),
                });
                setName("");
                setQuantity("");
                await mutate();
            } catch (err) {
                setError(errorMessage(err, "Could not create widget"));
            } finally {
                setCreating(false);
            }
        },
        [name, quantity, mutate],
    );

    let handleDelete = useCallback(
        async (id: string) => {
            setError(null);
            try {
                await deleteWidget(id);
                await mutate();
            } catch (err) {
                setError(errorMessage(err, "Could not delete widget"));
            }
        },
        [mutate],
    );

    return (
        <div className="max-w-2xl mx-auto p-6 space-y-6">
            <div className="space-y-1">
                <h1 className="text-3xl font-bold">Widgets</h1>
                <p className="text-muted-foreground text-sm">
                    The demo resource for this starter. Every widget is scoped
                    to your account.
                </p>
            </div>

            <form
                onSubmit={handleCreate}
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
                <div className="flex-1 flex flex-col gap-1">
                    <label className="text-muted-foreground text-xs">
                        Name
                    </label>
                    <Input
                        placeholder="Widget name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                    />
                </div>
                <div className="flex flex-col gap-1 sm:w-32">
                    <label className="text-muted-foreground text-xs">
                        Quantity
                    </label>
                    <Input
                        type="number"
                        min={0}
                        placeholder="0"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                    />
                </div>
                <Button
                    type="submit"
                    variant="default"
                    disabled={creating || name.trim() === ""}
                >
                    {creating ? "Adding..." : "Add widget"}
                </Button>
            </form>

            {error && <p className="text-destructive text-sm">{error}</p>}

            {widgets.isLoading ? (
                <p className="text-muted-foreground">Loading widgets...</p>
            ) : widgets.error ? (
                <p className="text-destructive">Failed to load widgets</p>
            ) : !widgets.data || widgets.data.length === 0 ? (
                <p className="text-muted-foreground">
                    No widgets yet. Create your first one above.
                </p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {widgets.data.map((widget) => (
                        <WidgetRow
                            key={widget.id}
                            widget={widget}
                            onDelete={handleDelete}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
}

function WidgetRow({
    widget,
    onDelete,
}: {
    widget: Widget;
    onDelete: (id: string) => void;
}) {
    return (
        <li className="flex items-center gap-4 bg-card border border-border rounded-lg p-4">
            <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">
                    {widget.name}
                </p>
                {widget.description && (
                    <p className="text-muted-foreground text-sm truncate">
                        {widget.description}
                    </p>
                )}
            </div>
            <span className="text-muted-foreground text-sm font-mono">
                x{widget.quantity}
            </span>
            <Button
                variant="destructive"
                size="sm"
                onClick={() => onDelete(widget.id)}
            >
                Delete
            </Button>
        </li>
    );
}
