import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { $env } from "../utils/env";
import { http } from "@pimasi/utils/lib/http";
import { $logger } from "../utils/logger";
import { NotImplemented, Unauthorized } from "@pimasi/utils/lib/error";

const client = $env.FIREBASE_ENABLED
    ? initializeApp({
          credential: cert({
              projectId: $env.FIREBASE_PROJECT_ID,
              clientEmail: $env.FIREBASE_CLIENT_EMAIL,
              privateKey: $env.FIREBASE_PRIVATE_KEY,
          }),
      })
    : null;

export async function getFirebaseAuthorizedDomains(): Promise<string[]> {
    if (!client) return [];

    try {
        let credential = client.options.credential!;
        let token = await credential.getAccessToken();

        let res = await http({
            url: `https://identitytoolkit.googleapis.com/admin/v2/projects/${$env.FIREBASE_PROJECT_ID}/config`,
            headers: {
                Authorization: `Bearer ${token.access_token}`,
            },
        });

        let config = res.data;

        return config.authorizedDomains ?? [];
    } catch (err: any) {
        $logger.warn(
            { error: err?.message },
            "failed to fetch firebase authorised domains",
        );
        return [];
    }
}

/**
 * Firebase auth-error markers that always mean "this credential is bad" and
 * should surface as 401 to the client. The identity-toolkit returns the
 * message in different shapes depending on transport (`err.error.message`,
 * `err.response.data.error.message`, `err.message`), so we match
 * substring against a stringified payload rather than a single property.
 */
const INVALID_CREDENTIAL_MARKERS = [
    "INVALID_LOGIN_CREDENTIALS",
    "INVALID_PASSWORD",
    "EMAIL_NOT_FOUND",
    "USER_DISABLED",
    "INVALID_EMAIL",
    "MISSING_PASSWORD",
];

export async function signInWithEmailAndPassword(
    email: string,
    password: string,
): Promise<{ idToken: string; refreshToken: string; localId: string }> {
    if (!$env.FIREBASE_ENABLED) {
        throw NotImplemented("firebase is not configured");
    }

    try {
        let res = await http({
            method: "POST",
            url: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${$env.FIREBASE_API_KEY}`,
            data: { email, password, returnSecureToken: true },
        });

        return res.data;
    } catch (err: any) {
        let payload = JSON.stringify({
            error: err?.error,
            response: err?.response?.data,
            message: err?.message,
        });

        if (INVALID_CREDENTIAL_MARKERS.some((m) => payload.includes(m))) {
            throw Unauthorized();
        }

        $logger.warn(
            { error: err?.message },
            "firebase signInWithEmailAndPassword failed",
        );
        throw err;
    }
}

export function isUrlOnAuthorizedDomain(
    url: string,
    authorizedDomains: string[],
): boolean {
    let hostname: string;

    try {
        hostname = new URL(url).hostname;
    } catch {
        return false;
    }

    return authorizedDomains.some(
        (d) => hostname === d || hostname.endsWith(`.${d}`),
    );
}

const overrides = {
    getFirebaseAuthorizedDomains,
    signInWithEmailAndPassword,
    isUrlOnAuthorizedDomain,
} as const;

type FirebaseAuth = ReturnType<typeof getAuth> & typeof overrides;

function disabledFirebaseAuth(): FirebaseAuth {
    return new Proxy(overrides, {
        get(target, prop, receiver) {
            if (prop in target) {
                return Reflect.get(target, prop, receiver);
            }
            return () => {
                throw NotImplemented("firebase is not configured");
            };
        },
    }) as unknown as FirebaseAuth;
}

export const $firebaseAuth: FirebaseAuth = client
    ? (Object.setPrototypeOf(overrides, getAuth(client)) as FirebaseAuth)
    : disabledFirebaseAuth();
