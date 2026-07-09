import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

function injectCordovaJs(): Plugin {
    return {
        name: "inject-cordova-js",
        transformIndexHtml() {
            return [
                {
                    tag: "script",
                    attrs: { src: "cordova.js" },
                    injectTo: "body",
                },
            ];
        },
    };
}

export default defineConfig(({ mode }) => ({
    base: mode === "cordova" ? "./" : "/",
    plugins: [
        tanstackRouter({
            generatedRouteTree: "__generated__/routeTree.gen.ts",
            tmpDir: "__generated__/.tmp",
        }),
        react(),
        tailwindcss(),
        mode === "cordova" && injectCordovaJs(),
    ],
    server: {
        host: "0.0.0.0",
        port: 5173,
    },
    resolve: {
        alias: {
            "@": "/src",
        },
    },
}));
