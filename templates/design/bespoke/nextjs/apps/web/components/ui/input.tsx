import { cn } from "@/lib/utils";

export function Input({
    className,
    ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            className={cn(
                `w-full px-4 py-2 rounded-lg bg-transparent border border-input text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50`,
                `[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`,
                className,
            )}
            {...props}
        />
    );
}
