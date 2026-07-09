import { Spinner } from "@/components/ui/spinner";

export function LoadingPage({ title }: { title?: string }) {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-background gap-6">
            {title ? (
                <h1 className="text-4xl font-bold text-primary">{title}</h1>
            ) : null}
            <Spinner />
        </div>
    );
}
