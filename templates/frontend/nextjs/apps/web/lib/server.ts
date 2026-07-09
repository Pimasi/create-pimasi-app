import { http } from "@pimasi/utils/lib/http";
import { $token } from "./token-storage";

let baseURL = process.env.NEXT_PUBLIC_API_URL;

export const $server = http.create({ baseURL, withCredentials: true });

/**
 * The public web URL of the frontend, used to seed `X-Frontend-Origin` so the
 * backend can mint user-facing links (e.g. password-reset emails) that point at
 * a real https:// URL.
 *
 * For a normal browser build we use `window.location.origin`. For a Cordova
 * static export the WebView origin is `file://` or a custom scheme that's
 * useless in an email — `NEXT_PUBLIC_PUBLIC_WEB_URL` should be set at build
 * time to the production web URL.
 */
function frontendOrigin(): string {
    let configured = process.env.NEXT_PUBLIC_PUBLIC_WEB_URL;
    if (configured && /^https?:\/\//.test(configured)) {
        return configured.replace(/\/+$/, "");
    }
    if (typeof window !== "undefined") {
        let origin = window.location.origin;
        if (/^https?:\/\//.test(origin)) return origin;
    }
    return "";
}

$server.interceptors.request.use(async (config) => {
    let token = $token.getAuth();

    let headers: Record<string, string> = { ...config.headers };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    let origin = frontendOrigin();
    if (origin) {
        headers["X-Frontend-Origin"] = origin;
    }

    config.headers = headers;
    return config;
});
