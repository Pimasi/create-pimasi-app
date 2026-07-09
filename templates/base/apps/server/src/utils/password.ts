import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Local password hashing using scrypt (RFC 7914). Stored as
 * `scrypt$N$r$p$salt_hex$hash_hex`. The cost parameters are baked into
 * the hash so they can be tuned in the future without invalidating
 * older entries.
 *
 * No external dep: scrypt ships in node:crypto.
 */

const SCHEME = "scrypt";
const N = 16384;
const r = 8;
const p = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

export function hashPassword(plain: string): string {
    let salt = randomBytes(SALT_BYTES);
    let derived = scryptSync(plain, salt, KEY_BYTES, { N, r, p });
    return [
        SCHEME,
        N,
        r,
        p,
        salt.toString("hex"),
        derived.toString("hex"),
    ].join("$");
}

export function verifyPassword(plain: string, stored: string): boolean {
    let parts = stored.split("$");
    if (parts.length !== 6) return false;
    let [scheme, nStr, rStr, pStr, saltHex, hashHex] = parts;
    if (scheme !== SCHEME) return false;

    let nParam = Number(nStr);
    let rParam = Number(rStr);
    let pParam = Number(pStr);
    if (
        !Number.isFinite(nParam) ||
        !Number.isFinite(rParam) ||
        !Number.isFinite(pParam)
    ) {
        return false;
    }

    let salt = Buffer.from(saltHex, "hex");
    let expected = Buffer.from(hashHex, "hex");
    let actual = scryptSync(plain, salt, expected.length, {
        N: nParam,
        r: rParam,
        p: pParam,
    });

    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
}
