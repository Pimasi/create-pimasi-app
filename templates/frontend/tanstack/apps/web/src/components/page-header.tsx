import type { ReactNode } from "react";

export interface PageSubLink {
    label: string;
    /** Route path for an enabled link, or null when the feature is greyed. */
    to?: string;
    /** Tooltip + reason shown when the link is disabled (`to` is null). */
    disabledReason?: string;
}

interface PageHeaderProps {
    /** Page label shown as the heading. */
    title: string;
    /** Optional sub-link rail rendered under the title. */
    subLinks?: PageSubLink[];
    /** Optional extra content rendered to the right of the title row. */
    actions?: ReactNode;
}

export function PageHeader({ title, subLinks, actions }: PageHeaderProps) {
    return (
        <div className="bg-card border border-border rounded-lg overflow-hidden mb-4">
            <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-lg font-semibold text-foreground truncate">
                    {title}
                </h2>
                {actions && (
                    <div className="flex items-center gap-3">{actions}</div>
                )}
            </div>
            {subLinks && subLinks.length > 0 && (
                <ul className="flex items-center gap-3 px-4 py-1.5 border-t border-border bg-background/40 text-xs">
                    {subLinks.map((link) => (
                        <SubLink key={link.label} {...link} />
                    ))}
                </ul>
            )}
        </div>
    );
}

function SubLink({ label, to, disabledReason }: PageSubLink) {
    if (!to) {
        return (
            <li>
                <span
                    className="text-muted-foreground opacity-50 cursor-not-allowed select-none"
                    title={disabledReason ?? undefined}
                >
                    {label}
                </span>
            </li>
        );
    }
    return (
        <li>
            <a href={to} className="text-primary hover:underline">
                {label}
            </a>
        </li>
    );
}
