import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { forgotPassword } from "../api/forgot-password";
import { useDocumentTitle } from "@/hooks/use-document-title";

export const Route = createFileRoute("/forgot-password")({
    component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
    let [email, setEmail] = useState("");
    let [loading, setLoading] = useState(false);
    let [sent, setSent] = useState(false);
    let [error, setError] = useState<string | null>(null);

    useDocumentTitle("Reset password");

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            await forgotPassword(email);

            setSent(true);
        } catch (err: any) {
            let message = err?.message ?? "Failed to send reset email";
            setError(message);
        } finally {
            setLoading(false);
        }
    }

    if (sent) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-65px)] gap-6 px-4">
                <div className="flex flex-col items-center gap-4 w-full max-w-sm text-center">
                    <h1 className="text-3xl font-bold">Check your email</h1>
                    <p className="text-muted-foreground">
                        If this email is registered, you'll receive a password
                        reset link.
                    </p>
                    <p className="text-muted-foreground">
                        Please check your inbox (and spam folder) to proceed.
                    </p>
                    <Link
                        to="/login"
                        className="text-primary hover:underline mt-4"
                    >
                        Back to login
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-65px)] gap-6 px-4">
            <h1 className="text-3xl font-bold">Reset password</h1>
            <p className="text-muted-foreground text-sm max-w-sm text-center">
                Enter your email address and we'll send you a link to reset your
                password.
            </p>

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

                {error && <p className="text-destructive text-sm">{error}</p>}

                <Button
                    type="submit"
                    variant="default"
                    size="lg"
                    disabled={loading || !email}
                >
                    {loading ? "Sending..." : "Send reset link"}
                </Button>
            </form>

            <Link
                to="/login"
                className="text-primary hover:underline text-sm"
            >
                Back to login
            </Link>
        </div>
    );
}
