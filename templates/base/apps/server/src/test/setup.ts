import { afterAll } from "vitest";
import { $test } from "./helpers";

afterAll(async () => {
    await $test.cleanup();
});
