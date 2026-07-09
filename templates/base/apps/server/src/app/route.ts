import { JsonSchema } from "@pimasi/utils/lib/json-schema";
import { Request, Response, RequestHandler } from "express";

export interface Route {
    method: "post" | "get" | "put" | "patch" | "delete";
    route: string;
    handler: RequestHandler | RequestHandler[];
    docs?: {
        badges?: { color?: string; label: string }[];
        disabled?: boolean;
        tags?: string[];
        description?: string;

        /**
         * @todo change this to either an enum or a boolean
         * an enum will need to check that the value provided is set in the server's swagger config
         * a boolean will need to assume the security scheme is unique per server
         *         security?: Record<string, []>[];
         */
        security?: boolean;
        deprecated?: boolean;
        parameters?: {
            in: "path" | "query" | "header";
            name: string;
            required?: true;
            schema?: JsonSchema;
            description?: string;
        }[];
        requestBody?: {
            required?: boolean;
            schema: JsonSchema;
        };
        responses?: {
            [k: number]: {
                description?: string;
                schema: JsonSchema;
            };
        };
        schemas?: {
            [k: string]: JsonSchema;
        };
    };
}

export class RouteClass {
    public method: "post" | "get" | "put" | "patch" | "delete";
    public route: string;
    public handler: RequestHandler | RequestHandler[];
    public docs?: Route["docs"];

    constructor({ method, route, handler, docs }: Route) {
        this.docs = docs;
        this.method = method;
        this.route = route;
        this.handler = handler;
    }
}

export function Route(route: Route): Route {
    return new RouteClass(route);
}

Route.isRoute = (obj): obj is Route => {
    return obj instanceof RouteClass;
};

export const asyncRoute = (
    handler: (req: Request, res: Response) => void,
): RequestHandler => {
    return async (req, res, next) => {
        try {
            await handler(req, res);
        } catch (err) {
            next(err);
        }
    };
};

Route.asyncRoute = asyncRoute;
