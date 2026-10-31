import * as React from "react";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { ButtonSize, ButtonVariant } from "./button.values";

const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
    {
        variants: {
            variant: {
                [ButtonVariant.DEFAULT]:
                    "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
                [ButtonVariant.DESTRUCTIVE]:
                    "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
                [ButtonVariant.OUTLINE]:
                    "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
                [ButtonVariant.SECONDARY]:
                    "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
                [ButtonVariant.GHOST]:
                    "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
                [ButtonVariant.LINK]:
                    "text-primary underline-offset-4 hover:underline",
            },
            size: {
                [ButtonSize.DEFAULT]: "h-9 px-4 py-2 has-[>svg]:px-3",
                [ButtonSize.SM]:
                    "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
                [ButtonSize.LG]: "h-10 rounded-md px-6 has-[>svg]:px-4",
                [ButtonSize.ICON]: "size-9",
            },
        },
        defaultVariants: {
            variant: ButtonVariant.DEFAULT,
            size: ButtonSize.DEFAULT,
        },
    },
);

function Button({
    className,
    variant,
    size,
    ...props
}: React.ComponentProps<"button"> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
}) {
    return (
        <button
            data-slot="button"
            className={cn(buttonVariants({ variant, size, className }))}
            {...props}
        />
    );
}

export { Button, buttonVariants };
