"use client";

import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    type ReactNode,
} from "react";
import { LoadingPage } from "@/components/loading-page";
import type { SessionUserResponse } from "@pimasi/lib/schemas/api/auth-session-user.schema";
import { $token } from "@/lib/token-storage";
import { fetchSessionUser, loginWithFirebaseToken } from "@/lib/auth-api";
import { $firebaseClient } from "@/lib/firebase";

const AuthContext = createContext<ReturnType<typeof authStore> | null>(null);

function authStore() {
    let [user, setUser] = useState<SessionUserResponse | null>(null);
    let [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!loading) return;

        async function load() {
            let token = $token.getAuth();
            if (!token) {
                setLoading(false);
                return;
            }

            try {
                setUser(await fetchSessionUser());
            } catch (err) {
                console.warn(err);
                $token.clearAll();
            } finally {
                setLoading(false);
            }
        }

        load();
    }, []);

    let login = useCallback(async (jwt: string) => {
        $token.setAuth(jwt);
        let sessionUser = await fetchSessionUser();
        setUser(sessionUser);
    }, []);

    let logout = useCallback(async () => {
        $token.clearAll();
        setUser(null);
    }, []);

    let loginWithFirebase = useCallback(async () => {
        let result = await $firebaseClient.signInWithPopup();
        let token = await loginWithFirebaseToken(
            await result.user.getIdToken(),
        );
        await login(token);
    }, [login]);

    let loginWithEmailLink = useCallback(async () => {
        let result = await $firebaseClient.signInWithEmailLink();
        if (!result) throw new Error("No result from email login");
        let token = await loginWithFirebaseToken(
            await result.user.getIdToken(),
        );
        await login(token);
    }, [login]);

    return {
        user,
        loading,
        login,
        logout,
        loginWithFirebase,
        loginWithEmailLink,
    } as const;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    let store = authStore();

    return (
        <AuthContext.Provider value={store}>
            {store.loading ? <LoadingPage /> : children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    let ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
