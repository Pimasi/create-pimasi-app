import express, { ErrorRequestHandler, RequestHandler, Router } from "express";
import { Route } from "./route";
import { $logger } from "../utils/logger";
import { createSwaggerDocs, SwaggerConfig } from "./swagger";
import { globSync } from "fs";

declare global {
    namespace Express {
        interface Request {
            raw: Buffer;
        }
    }
}

export async function AppServer({
    routes,
    preRouteMiddleware,
    postRouteMiddleware,
    swagger,
}: {
    preRouteMiddleware: (RequestHandler | [string, RequestHandler])[];
    routes: string | Route[];
    postRouteMiddleware: (RequestHandler | ErrorRequestHandler)[];
    swagger?: SwaggerConfig;
}) {
    const app = express();

    app.use((req, res, next) => {
        res.removeHeader("x-powered-by");
        return next();
    });

    app.use(
        express.json({
            verify: (req, res, buffer) => {
                (req as any).raw = buffer;
            },
            limit: "10mb",
        }),
    );

    preRouteMiddleware.forEach((middleware) => {
        Array.isArray(middleware)
            ? app.use(...middleware)
            : app.use(middleware);
    });

    let parsedRoutes = Array.isArray(routes)
        ? routes
        : await autoLoadRoutes(routes);

    let router = Router();

    for (let route of parsedRoutes) {
        router[route.method](route.route, route.handler);

        $logger.debug(
            `route registered: ${route.method.toUpperCase()} ${route.route}`,
        );
    }

    if (swagger && swagger?.enabled) {
        let path = swagger.path ?? "/docs";
        let specPath = `${path}/openapi.json`;

        let swaggerDocs = createSwaggerDocs({
            routes: parsedRoutes,
            ...swagger,
        });

        router.get(specPath, (req, res) => res.json(swaggerDocs));

        router.get(path, (req, res) => {
            res.send(`
                    <!doctype html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <script type="module" src="https://unpkg.com/rapidoc/dist/rapidoc-min.js"></script>
                    </head>
                    <body>
                        <rapi-doc show-curl-before-try="true" spec-url="${specPath}"></rapi-doc>
                    </body>
                    </html>
                    `);
        });
    }

    app.use(router);

    postRouteMiddleware.forEach((handler) => {
        app.use(handler);
    });

    return app;
}

function autoLoadRoutes(routesPath: string) {
    let fileNames = globSync(routesPath);

    let routes: Route[] = [];
    fileNames.forEach((fileName) => {
        try {
            let route = require(fileName);

            Object.entries(route).forEach(([name, route]) => {
                if (Route.isRoute(route)) {
                    routes.push(route);
                }
            });
        } catch (err: any) {
            $logger.warn({ fileName, err }, `Failed to load route file`);
        }
    });

    return routes;
}
