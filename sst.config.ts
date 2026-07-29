/// <reference path="./.sst/platform/config.d.ts" />

// Volt's infrastructure. Since openspec/changes/sell-cli-subscription this deploys exactly one thing: the
// static marketing site. Payment, EU VAT, licence keys and the customer portal are Polar's; there is no
// database, no auth and no backend of Volt's own.
//
// Providers removed with the gateway and the vendored console:
//   aws         nothing creates AWS resources any more (it also blocked every `sst` command locally, because
//               it pointed at `opencode-dev` / `opencode-production` SSO profiles that do not exist here)
//   stripe      Polar is the merchant of record
//   planetscale no database
//   honeycomb   Cloudflare Workers Logs
//   random      only used to generate a webhook secret for the console
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
