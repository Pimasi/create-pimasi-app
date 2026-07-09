"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/hooks/use-auth";
import { AppHeader } from "@/components/app-header";
import { Toaster } from "@/components/toaster";

export function Providers({ children }: { children: ReactNode }) {
    return (
        <AuthProvider>
            <div className="min-h-screen antialiased">
                <AppHeader />
                {children}
                <Toaster />
            </div>
        </AuthProvider>
    );
}
