import jwt from "jsonwebtoken";
import type { UserModel } from "../models/users";
import { getenv } from "@pimasi/utils/lib/helpers";
import { http } from "@pimasi/utils/lib/http";
import { seedUser, teardownSeed, cleanup, db } from "./db-helpers";

function signUserToken(userId: string): string {
    return jwt.sign({ type: "user", user_id: userId }, getenv("JWT_SECRET"), {
        expiresIn: "1h",
    });
}

async function seed(): Promise<{ user: UserModel; token: string }> {
    let user = await seedUser();
    let token = signUserToken(user.id);
    return { user, token };
}

function baseUrl(): string {
    return getenv("TEST_URL");
}

interface HttpOptions {
    token?: string;
    body?: any;
    headers?: Record<string, string>;
}

async function request<T = any>(
    method: string,
    path: string,
    opts: HttpOptions = {},
): Promise<{ status: number; data: T }> {
    let headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(opts.headers ?? {}),
    };
    if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

    let res = await http<T>({
        method,
        url: `${baseUrl()}${path}`,
        headers,
        data: method !== "GET" ? opts.body : undefined,
        validateStatus: () => true,
    });
    return { status: res.status, data: res.data };
}

async function get<T = any>(path: string, opts: HttpOptions = {}) {
    return request<T>("GET", path, opts);
}

async function post<T = any>(path: string, opts: HttpOptions = {}) {
    return request<T>("POST", path, opts);
}

async function put<T = any>(path: string, opts: HttpOptions = {}) {
    return request<T>("PUT", path, opts);
}

async function patch<T = any>(path: string, opts: HttpOptions = {}) {
    return request<T>("PATCH", path, opts);
}

async function del<T = any>(path: string, opts: HttpOptions = {}) {
    return request<T>("DELETE", path, opts);
}

export const $test = {
    seed,
    seedUser,
    teardownSeed,
    cleanup,
    get,
    post,
    put,
    patch,
    del,
    db,
};
