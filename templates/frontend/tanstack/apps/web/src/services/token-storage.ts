/**
 * Abstraction for auth-token persistence.
 *
 * The auth token is user-level, minted by /auth/login-* and /auth/register.
 * Default storage: localStorage (works in both browser and Cordova).
 */

const AUTH_KEY = "pimasi_auth_token";

export const $token = {
    getAuth: (): string | null => localStorage.getItem(AUTH_KEY),
    setAuth: (token: string) => localStorage.setItem(AUTH_KEY, token),
    removeAuth: () => localStorage.removeItem(AUTH_KEY),

    /** Clear every stored token — used on logout. */
    clearAll: () => {
        localStorage.removeItem(AUTH_KEY);
    },
};
