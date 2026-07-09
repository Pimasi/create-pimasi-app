import { cn } from "@/lib/utils";

interface SpinnerProps {
    className?: string;
}

export function Spinner({ className }: SpinnerProps) {
    return (
        <div
            className={cn(
                `animate-spin rounded-full border-2 border-muted-foreground border-t-transparent size-6`,
                className,
            )}
        />
    );
}
