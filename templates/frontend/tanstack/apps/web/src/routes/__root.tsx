import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Toaster } from "@/components/toaster";
import { AppHeader } from "@/components/app-header";
import { AuthProvider } from "../hooks/use-auth";

export const Route = createRootRoute({
    component: () => (
        <AuthProvider>
            <div className="min-h-screen antialiased">
                <AppHeader />
                <Outlet />
                <Toaster />
            </div>
        </AuthProvider>
    ),
});
