import { useEffect, type ReactNode } from "react";
import { LoadingPage } from "@/components/loading-page";
import { useAuth } from "../hooks/use-auth";

interface WithCredentialsProps {
    children: ReactNode;
    /** Called when the user is not authenticated. The consuming app provides navigation logic. */
    onUnauthenticated?: () => void;
}

export function WithCredentials({
    children,
    onUnauthenticated,
}: WithCredentialsProps) {
    let { user, loading } = useAuth();

    useEffect(() => {
        if (!loading && !user) {
            onUnauthenticated?.();
        }
    }, [loading, user, onUnauthenticated]);

    if (loading || !user) return <LoadingPage />;

    return <>{children}</>;
}
