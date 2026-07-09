import { Route } from "../../app/route";
import { Schema } from "@pimasi/utils/lib/json-schema";
import { Forbidden, Unauthorized } from "@pimasi/utils/lib/error";
import { $jwt } from "../../utils/jwt";
import { $users, normaliseEmail } from "../../models/users";
import { $firebaseAuth } from "../../services/firebase-admin";
import { hashPassword, verifyPassword } from "../../utils/password";
import { $logger } from "../../utils/logger";
import { LoginWithPasswordRequestSchema } from "@pimasi/lib/schemas/api/auth-login-password.schema";
import { LoginResponseSchema } from "@pimasi/lib/schemas/api/auth-login.schema";
import { ErrorResponseSchema } from "@pimasi/lib/schemas/api/error.schema";
import { RATE_LIMIT } from "../../middleware/rate-limit";

export const LoginWithPasswordRoute = Route({
    method: "post",
    route: "/auth/login-with-password",
    docs: {
        tags: ["Auth"],
        description:
            "Authenticate with email and password. Verifies against the locally-stored hash. Legacy accounts with no local hash fall back once to Firebase to migrate the password in.",
        requestBody: {
            required: true,
            schema: LoginWithPasswordRequestSchema,
        },
        responses: {
            200: {
                description: "JWT token",
                schema: LoginResponseSchema,
            },
            401: {
                description: "Invalid email or password",
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
            bucket: "login-pw",
            key: (req) =>
                typeof req.body?.email === "string"
                    ? `email:${normaliseEmail(req.body.email)}`
                    : null,
            max: 10,
            windowSeconds: 60,
        }),
        async (req, res) => {
            let raw = Schema.validate(req.body, LoginWithPasswordRequestSchema);
            let email = normaliseEmail(raw.email);
            let { password } = raw;

            let user = await $users.findByEmail(email);
            if (!user) throw Unauthorized();

            if (user.disabled_at) {
                throw Forbidden({}, "This account has been disabled.");
            }

            if (user.password_hash) {
                if (!verifyPassword(password, user.password_hash)) {
                    throw Unauthorized();
                }
                return res.json($jwt.signUser(user));
            }

            // Legacy migration path (edge case 7): user exists in Mongo but
            // has no local hash yet. Verify against Firebase exactly once,
            // then persist a local hash so subsequent logins skip Firebase.
            // If Firebase rejects, the password is wrong.
            try {
                await $firebaseAuth.signInWithEmailAndPassword(email, password);
            } catch {
                throw Unauthorized();
            }

            let passwordHash = hashPassword(password);
            await $users.update(user.id, { password_hash: passwordHash });
            $logger.info(
                { user_id: user.id },
                "migrated legacy user to local password hash",
            );

            return res.json($jwt.signUser(user));
        },
    ],
});
