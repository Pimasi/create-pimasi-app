import { getenv } from "@pimasi/utils/lib/helpers";

const VALID_NODE_ENVS = ["production", "development", "test"] as const;
type NodeEnv = (typeof VALID_NODE_ENVS)[number];

function validateNodeEnv(): NodeEnv {
    let value = process.env.NODE_ENV ?? "development";
    if (!VALID_NODE_ENVS.includes(value as NodeEnv)) {
        throw new Error(
            `Invalid NODE_ENV "${value}" — expected one of: ${VALID_NODE_ENVS.join(", ")}`,
        );
    }
    return value as NodeEnv;
}

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY ?? "";
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "";
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL ?? "";
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY ?? "";

export const $env = {
    NODE_ENV: validateNodeEnv(),
    APP_VERSION: process.env.APP_VERSION ?? "0.0.0",
    GIT_SHA: process.env.GIT_SHA ?? "unknown",
    PORT: Number(process.env.PORT ?? 3000),
    JWT_SECRET: getenv("JWT_SECRET"),
    REDIS_URL: process.env.REDIS_URL ?? "",
    RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED !== "false",
    NOTIFICATION_URL: process.env.NOTIFICATION_URL,
    TEST_URL: process.env.TEST_URL,

    FIREBASE_API_KEY,
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
    FIREBASE_ENABLED: Boolean(
        FIREBASE_PROJECT_ID &&
        FIREBASE_CLIENT_EMAIL &&
        FIREBASE_PRIVATE_KEY &&
        FIREBASE_API_KEY,
    ),

    DATABASE_URL: getenv("DATABASE_URL"),

    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY ?? "",
    SENDGRID_FROM_EMAIL:
        process.env.SENDGRID_FROM_EMAIL ?? "no-reply@example.com",
};
