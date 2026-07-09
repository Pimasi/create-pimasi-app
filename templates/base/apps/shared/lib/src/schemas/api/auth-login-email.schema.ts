import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export type LoginWithEmailRequest = Static<typeof LoginWithEmailRequestSchema>;
export const LoginWithEmailRequestSchema = Schema.Object({
    email: Schema.String({ format: "email" }),
    redirect_url: Schema.String(),
});
