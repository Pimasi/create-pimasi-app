import { AsyncLocalStorage } from "node:async_hooks";
import { UserModel } from "../models/users";

export const $session = new AsyncLocalStorage<{
    requestId?: string;
    user?: UserModel;
}>();
