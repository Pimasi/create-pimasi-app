import { Schema, Static } from "@pimasi/utils/lib/json-schema";

export type LoginWithPasswordRequest = Static<
    typeof LoginWithPasswordRequestSchema
>;
export const LoginWithPasswordRequestSchema = Schema.Object({
    email: Schema.String({ format: "email" }),
    password: Schema.String(),
});
