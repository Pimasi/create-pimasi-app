"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

export function AppHeader() {
    let { user, loading, logout } = useAuth();

    return (
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
            <Link href="/" className="text-xl font-bold text-primary">
                Pimasi Web
            </Link>

            <nav className="flex items-center gap-4">
                {loading ? null : user ? (
                    <>
                        <span className="text-muted-foreground text-sm">
                            {user.name}
                        </span>
                        <Button variant="outline" size="sm" onClick={logout}>
                            Log out
                        </Button>
                    </>
                ) : (
                    <Link href="/login">
                        <Button variant="default" size="sm">
                            Log in
                        </Button>
                    </Link>
                )}
            </nav>
        </header>
    );
}
