"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/hooks/use-auth";
import { confirmPasswordReset } from "@/lib/auth-api";
import { errorMessage } from "@/lib/errors";

export default function ResetPasswordPage() {
    let router = useRouter();
    let auth = useAuth();
    let [token, setToken] = useState<string | null>(null);
    let [ready, setReady] = useState(false);
    let [password, setPassword] = useState("");
    let [confirm, setConfirm] = useState("");
    let [error, setError] = useState<string | null>(null);
    let [loading, setLoading] = useState(false);

    useDocumentTitle("Reset password");

    useEffect(() => {
        let params = new URLSearchParams(window.location.search);
        setToken(params.get("token"));
        setReady(true);
    }, []);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);

        if (!token) {
            setError("This reset link is missing its token.");
            return;
        }
        if (password !== confirm) {
            setError("Passwords do not match");
            return;
        }

        setLoading(true);
        try {
            let result = await confirmPasswordReset(token, password);
            await auth.login(result.token);
            router.replace("/");
        } catch (err) {
            setError(errorMessage(err, "Failed to reset password"));
        } finally {
            setLoading(false);
        }
    }

    if (!ready) return null;

    if (!token) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-65px)] gap-6 px-4 text-center">
                <h1 className="text-3xl font-bold">Invalid reset link</h1>
                <p className="text-muted-foreground max-w-sm">
                    This password reset link is missing its token. Please
                    request a new one.
                </p>
                <Link
                    href="/forgot-password"
                    className="text-primary hover:underline"
                >
                    Request a new link
                </Link>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-65px)] gap-6 px-4">
            <h1 className="text-3xl font-bold">Choose a new password</h1>

            <form
                onSubmit={handleSubmit}
                className="flex flex-col gap-4 w-full max-w-sm"
            >
                <Input
                    type="password"
                    placeholder="New password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                />

                <Input
                    type="password"
                    placeholder="Confirm new password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={6}
                />

                {error && <p className="text-destructive text-sm">{error}</p>}

                <Button
                    type="submit"
                    variant="default"
                    size="lg"
                    disabled={loading}
                >
                    {loading ? "Saving..." : "Reset password"}
                </Button>
            </form>

            <Link
                href="/login"
                className="text-muted-foreground text-sm hover:text-muted-foreground"
            >
                Back to login
            </Link>
        </div>
    );
}
