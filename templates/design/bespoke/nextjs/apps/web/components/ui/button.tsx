import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?:
        "default" | "secondary" | "outline" | "ghost" | "destructive" | "link";
    size?: "default" | "sm" | "lg" | "icon";
}

export function Button({
    variant = "default",
    size = "default",
    className,
    children,
    ...props
}: ButtonProps) {
    let variantClasses = {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary:
            "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline:
            "border border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline",
    };

    let sizeClasses = {
        default: "px-4 py-2 text-base",
        sm: "px-3 py-1.5 text-sm",
        lg: "px-6 py-3 text-lg",
        icon: "size-10",
    };

    return (
        <button
            className={cn(
                `inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50`,
                variantClasses[variant],
                sizeClasses[size],
                className,
            )}
            {...props}
        >
            {children}
        </button>
    );
}
