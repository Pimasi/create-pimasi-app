import { $users, UserModel, normaliseEmail } from "../../models/users";
import { $logger } from "../../utils/logger";
import { createUser } from "./create-user";

/**
 * Find an existing user by Firebase UID *or* canonical email, or create a
 * fresh one. Email is the linking key — when a user already exists with
 * the email coming back from a Firebase token, we update their stored
 * `firebase_id` to the new UID (see ADR `firebase-uid-trust-on-conflict`)
 * but never overwrite their canonical email or any other field.
 */
export async function findOrCreateUser(params: {
    firebaseId: string;
    email: string;
    name?: string;
    emailVerified?: boolean;
}): Promise<UserModel> {
    let email = normaliseEmail(params.email);

    let user: UserModel | null = await $users.findByFirebaseOrEmail(
        params.firebaseId,
        email,
    );

    if (user) {
        if (user.firebase_id !== params.firebaseId) {
            // ADR `firebase-uid-trust-on-conflict`: trust the freshest
            // Firebase UID for an email and overwrite. Logged so an
            // operator can audit if it matters.
            $logger.warn(
                {
                    user_id: user.id,
                    old_firebase_id: user.firebase_id,
                    new_firebase_id: params.firebaseId,
                },
                "rebinding user to new firebase_id (ADR firebase-uid-trust-on-conflict)",
            );
            await $users.update(user.id, {
                firebase_id: params.firebaseId,
            });
            user = { ...user, firebase_id: params.firebaseId };
        }
        return user;
    }

    return await createUser({
        firebaseId: params.firebaseId,
        email,
        name: params.name,
        emailVerified: params.emailVerified,
    });
}
