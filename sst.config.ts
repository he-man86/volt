/// <reference path="./.sst/platform/config.d.ts" />

// Volt's infrastructure: exactly one thing, the static marketing site. Volt runs no backend of its own, so no
// provider is declared beyond Cloudflare (the home).
export default $config({
  app(input) {
    return {
      name: "volt",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "cloudflare",
    }
  },
  async run() {
    const { www } = await import("./infra/www.js")
    return {
      Www: www.url,
    }
  },
})
