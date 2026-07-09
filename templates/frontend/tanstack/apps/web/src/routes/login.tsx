import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "../hooks/use-auth";
import { loginWithEmail } from "../api/login-with-email";
import { loginWithPassword } from "../api/login-with-password";

export const Route = createFileRoute("/login")({
    component: LoginPage,
    validateSearch: (
        search: Record<string, unknown>,
    ): { redirect?: string } => ({
        redirect: search.redirect as string | undefined,
    }),
});

function LoginPage() {
    let [email, setEmail] = useState("");
    let [password, setPassword] = useState("");
    let [error, setError] = useState<string | null>(null);
    let [loading, setLoading] = useState(false);
    let [emailSent, setEmailSent] = useState(false);
    let navigate = useNavigate();
    let { redirect } = Route.useSearch();
    let redirectTo = redirect || "/widgets";
    let auth = useAuth();

    useDocumentTitle("Log in");

    useEffect(() => {
        if (auth.user) navigate({ to: redirectTo });
    }, [auth.user]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            let token = await loginWithPassword(email, password);
            await auth.login(token);
            navigate({ to: redirectTo });
        } catch (err: any) {
            let message =
                err?.response?.data?.message ?? err?.message ?? "Login failed";
            setError(message);
        } finally {
            setLoading(false);
        }
    }

    async function handleGoogleLogin() {
        setError(null);
        setLoading(true);

        try {
            await auth.loginWithFirebase();

            navigate({ to: redirectTo });
        } catch (err: any) {
            let message = err?.code ?? err?.message ?? "Login failed";
            setError(message.replace("auth/", ""));
        } finally {
            setLoading(false);
        }
    }

    async function handleEmailLink() {
        setError(null);
        setLoading(true);

        try {
            await loginWithEmail(email);

            setEmailSent(true);
        } catch (err: any) {
            let message = err?.message ?? "Failed to send login email";
            setError(message);
        } finally {
            setLoading(false);
        }
    }

    if (auth.loading) return null;

    if (emailSent) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-65px)] gap-6 px-4">
                <div className="flex flex-col items-center gap-4 w-full max-w-sm text-center">
                    <h1 className="text-3xl font-bold">Check your email</h1>
                    <p className="text-muted-foreground">
                        If this email is registered, you'll receive a login link
                        to access your account.
                    </p>
                    <p className="text-muted-foreground">
                        Please check your inbox (and spam folder) to proceed.
                    </p>
                    <Button
                        variant="outline"
                        size="lg"
                        onClick={() => setEmailSent(false)}
                        className="w-full max-w-sm mt-4"
                    >
                        Back to login
                    </Button>
                </div>
            </div>
        );
    }

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
                    to="/forgot-password"
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
                <Link
                    to="/register"
                    className="text-primary hover:underline"
                >
                    Register
                </Link>
            </p>
        </div>
    );
}
