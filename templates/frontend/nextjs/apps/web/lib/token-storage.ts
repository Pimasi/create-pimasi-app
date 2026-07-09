/**
 * Abstraction for auth-token persistence.
 *
 * The auth token is user-level, minted by /auth/login-* and /auth/register.
 * Default storage: localStorage (works in both browser and Cordova).
 * Every accessor guards for SSR, where `window` is undefined.
 */

const AUTH_KEY = "pimasi_auth_token";

function hasWindow(): boolean {
    return typeof window !== "undefined";
}

export const $token = {
    getAuth: (): string | null =>
        hasWindow() ? window.localStorage.getItem(AUTH_KEY) : null,
    setAuth: (token: string) => {
        if (hasWindow()) window.localStorage.setItem(AUTH_KEY, token);
    },
    removeAuth: () => {
        if (hasWindow()) window.localStorage.removeItem(AUTH_KEY);
    },

    /** Clear every stored token — used on logout. */
    clearAll: () => {
        if (hasWindow()) window.localStorage.removeItem(AUTH_KEY);
    },
};
