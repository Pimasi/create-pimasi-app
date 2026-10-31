import {
    ReadinessStatus,
    ReadinessCheckStatus,
} from "@pimasi/lib/values/health";
import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export type ReadyResponse = Static<typeof ReadyResponseSchema>;
export const ReadyResponseSchema = Schema.Object({
    status: Schema.AnyOf([
        Schema.Const(ReadinessStatus.READY),
        Schema.Const(ReadinessStatus.UNAVAILABLE),
    ]),
    checks: Schema.Record(
        Schema.String(),
        Schema.AnyOf([
            Schema.Const(ReadinessCheckStatus.OK),
            Schema.Const(ReadinessCheckStatus.FAILED),
        ]),
    ),
});
