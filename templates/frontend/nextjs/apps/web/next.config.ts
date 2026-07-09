import type { NextConfig } from "next";

let config: NextConfig = {
    reactStrictMode: true,
    transpilePackages: ["@pimasi/lib"],
};

if (process.env.CORDOVA_BUILD === "1") {
    config.output = "export";
    config.images = { unoptimized: true };
    config.trailingSlash = true;
}

export default config;
