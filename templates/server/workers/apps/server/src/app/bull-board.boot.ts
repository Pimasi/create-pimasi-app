import { Boot } from "./boot";
import { QueueMonitor } from "./queues";

export const BullBoardBoot = Boot({
    name: "bull-board",
    handler: async (ctx) => {
        if (ctx.isProduction) return;

        let { adapter } = await QueueMonitor();

        ctx.app.use("/bull", adapter.getRouter());
    },
});
