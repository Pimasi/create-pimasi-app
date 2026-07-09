import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import {
    RouterProvider,
    createRouter,
    createBrowserHistory,
    createHashHistory,
} from "@tanstack/react-router";
import { routeTree } from "../__generated__/routeTree.gen";
import "./styles.css";

const HISTORY =
    import.meta.env.MODE === "cordova"
        ? createHashHistory()
        : createBrowserHistory();

const ROUTER = createRouter({ routeTree, history: HISTORY });

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof ROUTER;
    }
}

let rootEl = document.getElementById("root")!;

ReactDOM.createRoot(rootEl).render(
    <StrictMode>
        <RouterProvider router={ROUTER} />
    </StrictMode>,
);
