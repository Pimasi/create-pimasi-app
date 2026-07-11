import type { Express } from "express";
import type { Server } from "node:http";

export interface BootContext {
    app: Express;
    httpServer: Server;
    isProduction: boolean;
}

export interface Boot {
    name: string;
    handler: (ctx: BootContext) => Promise<void> | void;
}

const _proto = {};
export function Boot(boot: Boot): Boot {
    return Object.setPrototypeOf(boot, _proto);
}

Boot.isBoot = (val: any): val is Boot => {
    return Object.getPrototypeOf(val) === _proto;
};
