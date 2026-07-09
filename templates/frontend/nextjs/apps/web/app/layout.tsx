import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
    title: "Pimasi Web",
    description: "A PIMASI full-stack starter",
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body className="bg-background text-foreground">
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
