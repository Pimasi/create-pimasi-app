import { UserRoles } from "@pimasi/lib/values/auth";
import { usersRepo } from "./users.impl";

export interface UserModel {
    id: string;
    created_at: Date;
    name: string;
    /**
     * Canonical email. Always stored lowercased; do not write a non-lowercase
     * value. Use `normaliseEmail()` at every entry point (route handlers,
     * queue jobs) before lookup or write.
     */
    email: string;
    /**
     * Whether the email address has been confirmed. True for users created
     * from a Firebase token whose `email_verified` claim was true (Google,
     * email-link), and for users who completed a password-reset confirmation.
     * False for fresh email/password registrations until they verify.
     */
    email_verified: boolean;
    /**
     * Local password hash (scheme$salt$hash). Absent ⇒ user has no local
     * password set (e.g. a Google-only sign-up that never set one). Such
     * users cannot authenticate via `/auth/login-with-password` and must
     * either log in with their provider or use the password-reset flow.
     */
    password_hash?: string;
    firebase_id?: string;
    /**
     * Set when an account is disabled. Login routes must reject disabled
     * accounts. Null/undefined for active accounts.
     */
    disabled_at?: Date | null;
    roles: UserRoles[];
}

export interface UsersRepo {
    findById(id: string): Promise<UserModel | null>;
    findByEmail(email: string): Promise<UserModel | null>;
    findByFirebaseOrEmail(
        firebaseId: string,
        email: string,
    ): Promise<UserModel | null>;
    insert(user: UserModel): Promise<void>;
    update(id: string, changes: Partial<UserModel>): Promise<void>;
}

export const $users: UsersRepo = usersRepo;

/**
 * Canonicalize an email for storage and lookup. All comparisons against
 * `users.email` MUST go through this function.
 */
export function normaliseEmail(email: string): string {
    return email.trim().toLowerCase();
}
