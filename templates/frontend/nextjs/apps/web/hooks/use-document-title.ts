import { useEffect } from "react";

export function useDocumentTitle(title: string) {
    useEffect(() => {
        document.title = title ? `${title} | Pimasi Web` : "Pimasi Web";
    }, [title]);
}
