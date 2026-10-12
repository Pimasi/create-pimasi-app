import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { $server } from "../services/server";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { errorMessage } from "@/services/errors";
import { useAuth } from "../hooks/use-auth";

export const Route = createFileRoute("/set-password")({
    component: SetPasswordPage,
});

function SetPasswordPage() {
    let [password, setPassword] = useState("");
    let [confirm, setConfirm] = useState("");
    let [error, setError] = useState<string | null>(null);
    let [loading, setLoading] = useState(false);
    let navigate = useNavigate();
    let auth = useAuth();

    useDocumentTitle("Set password");

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);

        if (password !== confirm) {
            setError("Passwords do not match");
            return;
        }

        setLoading(true);

        try {
            await $server({
                method: "POST",
                url: "/auth/set-password",
                data: { password },
            });
            navigate({ to: "/" });
        } catch (err: any) {
            setError(errorMessage(err));
        } finally {
            setLoading(false);
        }
    }

    if (!auth.user) return null;

    return (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-65px)] gap-6 px-4">
            <h1 className="text-3xl font-bold">Set Your Password</h1>
            <p className="text-muted-foreground text-sm max-w-sm text-center">
                You signed up with Google. Set a password so you can also log in
                with email and password.
            </p>

            <form
                onSubmit={handleSubmit}
                className="flex flex-col gap-4 w-full max-w-sm"
            >
                <Input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                />

                <Input
                    type="password"
                    placeholder="Confirm password"
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
                    {loading ? "Saving..." : "Set Password"}
                </Button>
            </form>

            <button
                type="button"
                onClick={() => navigate({ to: "/" })}
                className="text-muted-foreground text-sm hover:text-muted-foreground cursor-pointer"
            >
                Skip for now
            </button>
        </div>
    );
}
