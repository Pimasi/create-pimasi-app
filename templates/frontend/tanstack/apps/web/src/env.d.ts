interface ImportMetaEnv {
    readonly VITE_API_URL?: string;
    /**
     * Public https:// URL of the web frontend (no trailing slash).
     * Used in Cordova builds, where `window.location.origin` is
     * `file://` or a custom scheme and isn't usable as a public URL in
     * emails. Browser builds may leave this unset.
     */
    readonly VITE_PUBLIC_WEB_URL?: string;
    readonly VITE_FIREBASE_API_KEY?: string;
    readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
    readonly VITE_FIREBASE_PROJECT_ID?: string;
    readonly VITE_FIREBASE_APP_ID?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
