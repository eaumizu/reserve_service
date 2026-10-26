import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = { ...defineCloudflareConfig(), buildCommand: "npm run build" };
export default config;
