declare namespace NodeJS {
    interface ProcessEnv {
        readonly NEXT_PUBLIC_API_URL?: string;
        /**
         * Public https:// URL of the web frontend (no trailing slash).
         * Seeds `X-Frontend-Origin` so the backend can mint user-facing links
         * (e.g. password-reset emails). In a Cordova static export the WebView
         * origin is `file://` or a custom scheme and isn't usable in an email,
         * so this must be set at build time.
         */
        readonly NEXT_PUBLIC_PUBLIC_WEB_URL?: string;
        readonly NEXT_PUBLIC_FIREBASE_API_KEY?: string;
        readonly NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
        readonly NEXT_PUBLIC_FIREBASE_PROJECT_ID?: string;
        readonly NEXT_PUBLIC_FIREBASE_APP_ID?: string;
    }
}

declare module "*.css";
