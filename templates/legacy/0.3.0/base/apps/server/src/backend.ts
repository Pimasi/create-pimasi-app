import { $logger } from "./utils/logger";
import { REQUEST_LOGGER_MIDDLEWARE } from "./middleware/log-request";
import { REQUEST_ID_MIDDLEWARE } from "./middleware/request-id";
import { AppServer } from "./app/http-server";
import { Boot } from "./app/boot";
import { $session } from "./app/session.service";
import { $env } from "./utils/env";
import { ERROR_HANDLER_MIDDLEWARE } from "./middleware/error-handler";
import { PARSE_SESSION_MIDDLEWARE } from "./handlers/auth/parse-session.middleware";
import { runMigrations } from "./migrations";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { globSync } from "fs";
import cors from "cors";
import { RequestHandler } from "express";

$session.run({}, async () => {
    await runMigrations();

    let isProduction = $env.NODE_ENV === "production";

    let preRouteMiddleware: (RequestHandler | [string, RequestHandler])[] = [
        cors({ origin: true, credentials: true }),
        REQUEST_ID_MIDDLEWARE,
        REQUEST_LOGGER_MIDDLEWARE,
        PARSE_SESSION_MIDDLEWARE,
    ];

    let app = await AppServer({
        swagger: {
            securityType: "bearer",
            enabled: !isProduction,
            info: {
                title: "Pimasi Starter API",
            },
        },
        preRouteMiddleware,
        routes: resolve(__dirname, "./**/*.route.{ts,js}"),
        postRouteMiddleware: [ERROR_HANDLER_MIDDLEWARE],
    });

    let server = createServer(app);

    let bootFiles = globSync(resolve(__dirname, "./**/*.boot.{ts,js}"));

    let boots: Boot[] = [];
    bootFiles.forEach((fileName) => {
        try {
            let module = require(fileName);

            Object.entries(module).forEach(([name, boot]) => {
                if (Boot.isBoot(boot)) {
                    boots.push(boot);
                }
            });
        } catch (err: any) {
            $logger.warn({ fileName, err }, `Failed to load boot file`);
        }
    });

    for (let boot of boots) {
        await boot.handler({ app, httpServer: server, isProduction });

        $logger.debug(`boot hook ran: ${boot.name}`);
    }

    server.listen($env.PORT, () => {
        $logger.debug(`Debug mode enabled`);
        $logger.info(`Server listening on port: ${$env.PORT}`);
    });
});
