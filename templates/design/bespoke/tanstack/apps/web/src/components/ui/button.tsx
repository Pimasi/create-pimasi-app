import { cn } from "@/lib/utils";
import { ButtonSize, ButtonVariant } from "./button.values";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
}

export function Button({
    variant = ButtonVariant.DEFAULT,
    size = ButtonSize.DEFAULT,
    className,
    children,
    ...props
}: ButtonProps) {
    let variantClasses = {
        [ButtonVariant.DEFAULT]:
            "bg-primary text-primary-foreground hover:bg-primary/90",
        [ButtonVariant.SECONDARY]:
            "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        [ButtonVariant.OUTLINE]:
            "border border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
        [ButtonVariant.GHOST]:
            "text-foreground hover:bg-accent hover:text-accent-foreground",
        [ButtonVariant.DESTRUCTIVE]:
            "bg-destructive text-white hover:bg-destructive/90",
        [ButtonVariant.LINK]: "text-primary underline-offset-4 hover:underline",
    };

    let sizeClasses = {
        [ButtonSize.DEFAULT]: "px-4 py-2 text-base",
        [ButtonSize.SM]: "px-3 py-1.5 text-sm",
        [ButtonSize.LG]: "px-6 py-3 text-lg",
        [ButtonSize.ICON]: "size-10",
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
