"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/hooks/use-auth";
import { loginWithPassword } from "@/lib/auth-api";
import { errorMessage } from "@/lib/errors";

export default function LoginPage() {
    let [email, setEmail] = useState("");
    let [password, setPassword] = useState("");
    let [error, setError] = useState<string | null>(null);
    let [loading, setLoading] = useState(false);
    let router = useRouter();
    let auth = useAuth();

    useDocumentTitle("Log in");

    useEffect(() => {
        if (auth.user) router.replace("/widgets");
    }, [auth.user, router]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            let token = await loginWithPassword(email, password);
            await auth.login(token);
            router.replace("/widgets");
        } catch (err) {
            setError(errorMessage(err, "Login failed"));
        } finally {
            setLoading(false);
        }
    }

    async function handleGoogleLogin() {
        setError(null);
        setLoading(true);

        try {
            await auth.loginWithFirebase();
            router.replace("/widgets");
        } catch (err: any) {
            let message = err?.code ?? err?.message ?? "Login failed";
            setError(message.replace("auth/", ""));
        } finally {
            setLoading(false);
        }
    }

    if (auth.loading) return null;

    return (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-65px)] gap-6 px-4">
            <h1 className="text-3xl font-bold">Log in</h1>

            <form
                onSubmit={handleSubmit}
                className="flex flex-col gap-4 w-full max-w-sm"
            >
                <Input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                />

                <Input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                />

                {error && <p className="text-destructive text-sm">{error}</p>}

                <Button
                    type="submit"
                    variant="default"
                    size="lg"
                    disabled={loading}
                >
                    {loading ? "Logging in..." : "Log in"}
                </Button>
            </form>

            <div className="flex justify-between w-full max-w-sm text-sm">
                <Link
                    href="/forgot-password"
                    className="text-primary hover:underline"
                >
                    Forgot password?
                </Link>
            </div>

            <div className="flex items-center gap-4 w-full max-w-sm">
                <div className="flex-1 h-px bg-border" />
                <span className="text-muted-foreground text-sm">or</span>
                <div className="flex-1 h-px bg-border" />
            </div>

            <Button
                variant="outline"
                size="lg"
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full max-w-sm"
            >
                Continue with Google
            </Button>

            <p className="text-muted-foreground text-sm">
                Don&apos;t have an account?{" "}
                <Link href="/register" className="text-primary hover:underline">
                    Register
                </Link>
            </p>
        </div>
    );
}
