import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { register } from "../api/register-user";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "../hooks/use-auth";

export const Route = createFileRoute("/register")({
    component: RegisterPage,
});

function RegisterPage() {
    let [email, setEmail] = useState("");
    let [password, setPassword] = useState("");
    let [error, setError] = useState<string | null>(null);
    let [loading, setLoading] = useState(false);
    let navigate = useNavigate();
    let auth = useAuth();

    useDocumentTitle("Register");

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            let token = await register(email, password);
            await auth.login(token);
            navigate({ to: "/" });
        } catch (err: any) {
            let message = err?.code ?? err?.message ?? "Registration failed";
            setError(message.replace("auth/", ""));
        } finally {
            setLoading(false);
        }
    }

    async function handleGoogleLogin() {
        setError(null);
        setLoading(true);

        try {
            await auth.loginWithFirebase();
            navigate({ to: "/" });
        } catch (err: any) {
            let message = err?.code ?? err?.message ?? "Registration failed";
            setError(message.replace("auth/", ""));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-65px)] gap-6 px-4">
            <h1 className="text-3xl font-bold">Create Account</h1>

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
                    minLength={6}
                />

                {error && <p className="text-destructive text-sm">{error}</p>}

                <Button
                    type="submit"
                    variant="default"
                    size="lg"
                    disabled={loading}
                >
                    {loading ? "Creating account..." : "Register"}
                </Button>
            </form>

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
                Already have an account?{" "}
                <Link to="/login" className="text-primary hover:underline">
                    Log in
                </Link>
            </p>
        </div>
    );
}
