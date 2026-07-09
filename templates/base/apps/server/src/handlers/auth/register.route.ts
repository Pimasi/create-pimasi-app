import { Route } from "../../app/route";
import { Schema } from "@pimasi/utils/lib/json-schema";
import { Conflict, Forbidden } from "@pimasi/utils/lib/error";
import { $jwt } from "../../utils/jwt";
import { $users, normaliseEmail } from "../../models/users";
import { $firebaseAuth } from "../../services/firebase-admin";
import { createUser } from "../user/create-user";
import { hashPassword } from "../../utils/password";
import { $logger } from "../../utils/logger";
import { $env } from "../../utils/env";
import { RegisterRequestSchema } from "@pimasi/lib/schemas/api/auth-register.schema";
import { LoginResponseSchema } from "@pimasi/lib/schemas/api/auth-login.schema";
import { ErrorResponseSchema } from "@pimasi/lib/schemas/api/error.schema";
import { RATE_LIMIT } from "../../middleware/rate-limit";

export const RegisterRoute = Route({
    method: "post",
    route: "/auth/register",
    docs: {
        tags: ["Auth"],
        description:
            "Create a user with email and password. Stores a locally-hashed password; when Firebase is configured, also provisions a matching Firebase identity so the same account can be linked to Firebase-backed flows (Google sign-in, email-link).",
        requestBody: {
            required: true,
            schema: RegisterRequestSchema,
        },
        responses: {
            200: {
                description: "JWT token",
                schema: LoginResponseSchema,
            },
            409: {
                description: "Email already in use",
                schema: ErrorResponseSchema,
            },
            403: {
                description: "Account disabled",
                schema: ErrorResponseSchema,
            },
        },
    },
    handler: [
        RATE_LIMIT({
            bucket: "register",
            key: (req) =>
                typeof req.body?.email === "string"
                    ? `email:${normaliseEmail(req.body.email)}`
                    : null,
            max: 5,
            windowSeconds: 60,
        }),
        async (req, res) => {
            let raw = Schema.validate(req.body, RegisterRequestSchema);
            let email = normaliseEmail(raw.email);
            let { password } = raw;

            let existing = await $users.findByEmail(email);
            if (existing) {
                if (existing.disabled_at) {
                    throw Forbidden(
                        { email },
                        "This account has been disabled.",
                    );
                }
                throw Conflict(
                    { email },
                    "An account with this email already exists. Please log in instead.",
                );
            }

            let firebaseId: string | undefined = undefined;
            if ($env.FIREBASE_ENABLED) {
                // Provision the Firebase identity. If a stale Firebase account
                // exists for this email (e.g. an earlier failed registration
                // never wrote to Mongo), reuse it rather than failing.
                try {
                    let firebaseUser = await $firebaseAuth.createUser({
                        email,
                        password,
                    });
                    firebaseId = firebaseUser.uid;
                } catch (err: any) {
                    if (err?.errorInfo?.code === "auth/email-already-exists") {
                        $logger.warn(
                            { email },
                            "firebase user existed without mongo user — reusing",
                        );
                        let existingFirebase =
                            await $firebaseAuth.getUserByEmail(email);
                        firebaseId = existingFirebase.uid;
                        await $firebaseAuth.updateUser(firebaseId, {
                            password,
                        });
                    } else {
                        throw err;
                    }
                }
            }

            let passwordHash = hashPassword(password);

            let user = await createUser({
                firebaseId,
                email,
                emailVerified: false,
                passwordHash,
            });

            return res.json($jwt.signUser(user));
        },
    ],
});
