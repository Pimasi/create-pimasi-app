import jwt from "jsonwebtoken";
import { $env } from "./env";
import { UserModel } from "../models/users";

export interface UserToken {
    type: "user";
    user_id: string;
}

export type AnyToken = UserToken;

export const $jwt = {
    signUser: (
        user: UserModel,
        options: jwt.SignOptions = { expiresIn: "180 days" },
    ) => {
        let payload: UserToken = { type: "user", user_id: user.id };
        return jwt.sign(payload, $env.JWT_SECRET, options);
    },

    verify: (token: string): UserToken => {
        let decoded = jwt.verify(token, $env.JWT_SECRET) as any;

        if (decoded?.type !== "user" || typeof decoded.user_id !== "string") {
            throw new Error("token is not a user token");
        }

        return { type: "user", user_id: decoded.user_id };
    },
};
