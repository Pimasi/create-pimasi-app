import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "../hooks/use-auth";

export const Route = createFileRoute("/")({
    component: HomePage,
});

function HomePage() {
    let { user } = useAuth();
    useDocumentTitle("");

    return (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-65px)] gap-6 px-4">
            <div className="flex flex-col items-center gap-6 text-center">
                <h1 className="text-5xl font-bold text-primary">
                    Pimasi Starter
                </h1>
                <p className="text-muted-foreground text-lg">
                    A PIMASI full-stack starter
                </p>
                {user ? (
                    <Link to="/widgets">
                        <Button variant="default" size="lg">
                            Open widgets
                        </Button>
                    </Link>
                ) : (
                    <Link to="/login">
                        <Button variant="default" size="lg">
                            Log in
                        </Button>
                    </Link>
                )}
            </div>
        </div>
    );
}
