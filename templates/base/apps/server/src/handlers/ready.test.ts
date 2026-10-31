import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { http } from "@pimasi/utils/lib/http";
import { AppServer } from "../app/http-server";
import { registerReadinessCheck } from "../app/readiness";
import { $test } from "../test/helpers";
import { ReadyRoute } from "./ready.route";
import { PingRoute } from "./ping.route";

describe("GET /ready", () => {
    let server: Server;
    let baseUrl: string;

    beforeAll(async () => {
        let app = await AppServer({
            routes: [ReadyRoute, PingRoute],
            preRouteMiddleware: [],
            postRouteMiddleware: [],
        });
        server = createServer(app);
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    });

    it("returns 200 while the database is ready without authentication", async () => {
        let res = await $test.get("/ready");

        expect(res.status).toBe(200);
        expect(res.data.status).toBe("ready");
        expect(res.data.checks.database).toBe("ok");
        expect(Object.values(res.data.checks)).not.toContain("failed");
    });

    it("returns 200 when no checks are registered", async () => {
        let res = await http({ url: `${baseUrl}/ready` });

        expect(res.status).toBe(200);
        expect(res.data).toEqual({ status: "ready", checks: {} });
    });

    it("returns 503 for a failing database check without affecting liveness", async () => {
        let remove = registerReadinessCheck("database", async () => {
            throw new Error("private database connection details");
        });
        let removePassing = registerReadinessCheck(
            "independent",
            async () => {},
        );
        try {
            let ready = await http({
                url: `${baseUrl}/ready`,
                validateStatus: () => true,
            });
            let ping = await http({ url: `${baseUrl}/ping` });

            expect(ready.status).toBe(503);
            expect(ready.data).toEqual({
                status: "unavailable",
                checks: { database: "failed", independent: "ok" },
            });
            expect(ping.status).toBe(200);
            expect(ping.data.message).toBe("pong");
        } finally {
            remove();
            removePassing();
        }
    });
});
