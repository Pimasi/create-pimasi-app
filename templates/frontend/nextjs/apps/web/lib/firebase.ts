import { initializeApp, type FirebaseApp } from "firebase/app";
import {
    getAuth,
    GoogleAuthProvider,
    inMemoryPersistence,
    isSignInWithEmailLink,
    setPersistence,
    signInWithEmailLink,
    signInWithPopup,
    type Auth,
} from "firebase/auth";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let googleProvider: GoogleAuthProvider | null = null;

export function isFirebaseConfigured(): boolean {
    return !!firebaseConfig.apiKey;
}

function ensureAuth(): Auth {
    if (!isFirebaseConfigured()) {
        throw new Error(
            "Firebase is not configured (NEXT_PUBLIC_FIREBASE_API_KEY is unset)",
        );
    }
    if (!auth) {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        googleProvider = new GoogleAuthProvider();
        setPersistence(auth, inMemoryPersistence);
    }
    return auth;
}

export const $firebaseClient = {
    get app() {
        return app;
    },
    get auth() {
        return auth;
    },
    async signInWithPopup() {
        let a = ensureAuth();
        return await signInWithPopup(a, googleProvider!);
    },

    async signInWithEmailLink() {
        let a = ensureAuth();
        let href = window.location.href;
        let url = new URL(href);

        let isEmailLogin = await isSignInWithEmailLink(a, href);

        if (!isEmailLogin) return;

        return await signInWithEmailLink(
            a,
            url.searchParams.get("email")!,
            href,
        );
    },
};
