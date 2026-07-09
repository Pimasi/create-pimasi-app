import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
    return (
        <SonnerToaster
            position="top-right"
            theme="dark"
            richColors
            closeButton
            toastOptions={{
                classNames: {
                    toast: "bg-card border border-border text-foreground",
                    description: "text-muted-foreground",
                    success: "border-success",
                    error: "border-destructive",
                },
            }}
        />
    );
}
