import { Route } from "../../app/route";
import { Schema } from "@pimasi/utils/lib/json-schema";
import {
    Forbidden,
    NotImplemented,
    Unauthorized,
} from "@pimasi/utils/lib/error";
import { $env } from "../../utils/env";
import { $jwt } from "../../utils/jwt";
import {
    LoginRequestSchema,
    LoginResponseSchema,
} from "@pimasi/lib/schemas/api/auth-login.schema";
import { ErrorResponseSchema } from "@pimasi/lib/schemas/api/error.schema";
import { $firebaseAuth } from "../../services/firebase-admin";
import { findOrCreateUser } from "../user/find-or-create-user";
import { $users, normaliseEmail } from "../../models/users";
import { $logger } from "../../utils/logger";
import { RATE_LIMIT } from "../../middleware/rate-limit";

export const LoginWithFirebaseRoute = Route({
    method: "post",
    route: `/auth/login-with-firebase`,
    docs: {
        tags: ["Auth"],
        description:
            "Authenticate with a Firebase ID token (Google, email-link). Creates a new user if the email is unknown, or links to an existing local account by email if present.",
        requestBody: {
            required: true,
            schema: LoginRequestSchema,
        },
        responses: {
            200: {
                description: "JWT token",
                schema: LoginResponseSchema,
            },
            401: {
                description: "Invalid or expired Firebase token",
                schema: ErrorResponseSchema,
            },
            403: {
                description:
                    "Email not verified by provider, or account disabled",
                schema: ErrorResponseSchema,
            },
        },
    },
    handler: [
        RATE_LIMIT({
            bucket: "login-fb",
            key: "ip",
            max: 30,
            windowSeconds: 60,
        }),
        async (req, res) => {
            if (!$env.FIREBASE_ENABLED) {
                throw NotImplemented("firebase login is not enabled");
            }

            let { token } = Schema.validate(req.body, LoginRequestSchema);

            let firebaseUser;
            try {
                firebaseUser = await $firebaseAuth.verifyIdToken(token);
            } catch {
                throw Unauthorized("Invalid or expired Firebase token");
            }

            if (!firebaseUser.email) {
                throw Unauthorized("Firebase token has no email claim");
            }

            let email = normaliseEmail(firebaseUser.email);

            // Find by either firebase_id or email. If the user exists with
            // a different firebase_id, findOrCreateUser will rebind per
            // ADR `firebase-uid-trust-on-conflict` — but only when we trust
            // this email. We refuse to auto-link an unverified Firebase
            // email to an existing account because that would let an
            // attacker who claims (but doesn't own) someone else's email
            // take over their account.
            let existing = await $users.findByEmail(email);
            if (
                existing &&
                existing.firebase_id !== firebaseUser.uid &&
                !firebaseUser.email_verified
            ) {
                $logger.warn(
                    {
                        user_id: existing.id,
                        token_uid: firebaseUser.uid,
                        email,
                    },
                    "refusing to link unverified firebase email to existing account",
                );
                throw Forbidden(
                    {},
                    "This provider hasn't verified your email yet. Verify with your provider first, or sign in with your existing account and link from settings.",
                );
            }

            // For brand-new accounts we also require a verified email so
            // we don't seed Mongo with an unverified address.
            if (!existing && !firebaseUser.email_verified) {
                throw Forbidden(
                    {},
                    "Your provider hasn't verified your email address yet.",
                );
            }

            let user = await findOrCreateUser({
                firebaseId: firebaseUser.uid,
                email,
                name: firebaseUser.name,
                emailVerified: firebaseUser.email_verified ?? false,
            });

            if (user.disabled_at) {
                throw Forbidden({}, "This account has been disabled.");
            }

            // Once we trust the email is verified by the provider, mark
            // it verified locally too if we haven't already.
            if (firebaseUser.email_verified && !user.email_verified) {
                await $users.update(user.id, { email_verified: true });
            }

            return res.json($jwt.signUser(user));
        },
    ],
});
