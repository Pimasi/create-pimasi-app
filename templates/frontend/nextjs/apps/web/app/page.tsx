"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

export default function HomePage() {
    let { user } = useAuth();

    return (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-65px)] gap-6 px-4">
            <div className="flex flex-col items-center gap-6 text-center">
                <h1 className="text-5xl font-bold text-primary">
                    {user ? `Hello, ${user.name}` : "Pimasi Web"}
                </h1>
                <p className="text-muted-foreground text-lg">
                    {user ? (
                        <>
                            Get started by editing{" "}
                            <code>apps/web/app/page.tsx</code>.
                        </>
                    ) : (
                        "A PIMASI full-stack starter"
                    )}
                </p>
                {!user && (
                    <Link href="/login">
                        <Button variant="default" size="lg">
                            Log in
                        </Button>
                    </Link>
                )}
            </div>
        </div>
    );
}
