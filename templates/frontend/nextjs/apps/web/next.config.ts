import type { NextConfig } from "next";

enum CordovaBuild {
    ENABLED = "1",
}

let config: NextConfig = {
    reactStrictMode: true,
    transpilePackages: ["@pimasi/lib"],
};

if (process.env.CORDOVA_BUILD === CordovaBuild.ENABLED) {
    config.output = "export";
    config.images = { unoptimized: true };
    config.trailingSlash = true;
}

export default config;
