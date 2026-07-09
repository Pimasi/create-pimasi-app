import { ulid } from "ulid";
import { $users, UserModel, normaliseEmail } from "../../models/users";
import { UserRoles } from "@pimasi/lib/values/auth";

export async function createUser(params: {
    firebaseId?: string;
    email: string;
    name?: string;
    emailVerified?: boolean;
    passwordHash?: string;
}): Promise<UserModel> {
    let email = normaliseEmail(params.email);

    let user: UserModel = {
        id: ulid(),
        created_at: new Date(),
        name: params.name ?? email.split("@")[0],
        email,
        email_verified: params.emailVerified ?? false,
        password_hash: params.passwordHash,
        firebase_id: params.firebaseId,
        disabled_at: null,
        roles: [UserRoles.USER],
    };

    await $users.insert(user);

    return user;
}
