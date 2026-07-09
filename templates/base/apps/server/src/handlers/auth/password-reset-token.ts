import { randomBytes } from "node:crypto";
import { $redis } from "../../services/redis";

const PREFIX = "auth:password-reset:";
const TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Allocate a single-use password-reset token. The token is the only thing
 * the user needs to present to /auth/confirm-password-reset; we store the
 * mapping `token → user_id` in Redis with a 1h TTL.
 *
 * Token format: 32 random bytes, base64url. ~256 bits of entropy — high
 * enough that brute force isn't a concern with the TTL.
 */
export async function issuePasswordResetToken(
    userId: string,
): Promise<string> {
    let token = randomBytes(32).toString("base64url");
    await $redis.set(`${PREFIX}${token}`, userId, { EX: TTL_SECONDS });
    return token;
}

/**
 * Look up the user_id a reset token was issued for, and consume the token
 * so it can't be reused. Returns null if the token is unknown or expired.
 */
export async function consumePasswordResetToken(
    token: string,
): Promise<string | null> {
    let key = `${PREFIX}${token}`;
    let userId = await $redis.get(key);
    if (!userId) return null;
    await $redis.del(key);
    return userId;
}
