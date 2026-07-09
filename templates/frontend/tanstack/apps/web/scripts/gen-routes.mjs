import { Generator, getConfig } from "@tanstack/router-generator";
import path from "node:path";

let root = path.resolve(new URL(".", import.meta.url).pathname, "..");
let config = getConfig({}, root);
let generator = new Generator({ config, root });
await generator.run();
console.log("route tree regenerated at", config.generatedRouteTree);
