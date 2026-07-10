import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { $env } from "../../utils/env";
import { $users } from "../../models/users";

function passwordFingerprint(passwordHash: string | undefined): string {
    return createHash("sha256")
        .update(passwordHash ?? "")
        .digest("hex")
        .slice(0, 16);
}

export async function issuePasswordResetToken(
    userId: string,
): Promise<string> {
    let user = await $users.findById(userId);

    let payload = {
        type: "password_reset",
        user_id: userId,
        pwd: passwordFingerprint(user?.password_hash),
    };

    return jwt.sign(payload, $env.JWT_SECRET, { expiresIn: "1h" });
}

export async function consumePasswordResetToken(
    token: string,
): Promise<string | null> {
    let decoded: any;
    try {
        decoded = jwt.verify(token, $env.JWT_SECRET);
    } catch {
        return null;
    }

    if (decoded?.type !== "password_reset") return null;
    if (typeof decoded.user_id !== "string") return null;

    let user = await $users.findById(decoded.user_id);
    if (!user) return null;
    if (decoded.pwd !== passwordFingerprint(user.password_hash)) return null;

    return decoded.user_id;
}
