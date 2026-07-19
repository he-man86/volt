/// <reference path="./.sst/platform/config.d.ts" />

// Volt commercial backend — SST app (vendored from opencode, rewired for Volt).
// Provisions: PlanetScale DB, OpenAuth issuer, Stripe billing, the console/app frontend.
// TODO(volt) markers below flag the values only you can fill (accounts, domain, org names).
export default $config({
  app(input) {
    return {
      name: "volt",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "cloudflare",
      providers: {
        // No `aws` provider: the vendored infra creates zero AWS resources (the dropped lake/stats used it;
        // email uses SES-over-HTTP with AWS_SES_* keys, not the Pulumi provider). Add it back only if you
        // introduce real AWS resources — then set a `volt-*` AWS profile.
        stripe: {
          version: "0.0.28",
          apiKey: process.env.STRIPE_SECRET_KEY!,
        },
        random: "4.19.2",
        planetscale: "0.4.1",
        // Honeycomb (observability alerts) — only declared once you have an account, so a deploy without
        // HONEYCOMB_API_KEY still works. Set the env var to activate success-rate monitoring (infra/monitoring.ts).
        ...(process.env.HONEYCOMB_API_KEY ? { honeycomb: "0.49.0" } : {}),
      },
    }
  },
  async run() {
    const stage = await import("./infra/stage.js")
    // console.ts pulls in ./app (secrets), the DB, auth issuer, Stripe, and the console frontend (at the apex).
    const { stat } = await import("./infra/console.js")
    // www.ts: Volt's public marketing site (packages/volt-www) at `www.${domain}`. The console keeps the apex, so
    // there's no domain migration — a fresh StaticSite on a new hostname.
    await import("./infra/www.js")
    // support.ts: the vendored per-customer support-lookup portal at `support.${domain}`, gated by Cloudflare
    // Access. Deployed as-is (no edit to the opencode package); see infra/support.ts for the Access prereqs.
    await import("./infra/support.js")
    // Success-rate monitoring: Honeycomb error-rate SLOs + alerts. Gated on the key so it can't break a
    // pre-Honeycomb deploy. Telemetry SEND (log-processor → Honeycomb) activates via the HONEYCOMB_API_KEY secret.
    if (process.env.HONEYCOMB_API_KEY) await import("./infra/monitoring.js")
    return {
      StatWorkerUrl: stat.url,
      AwsStage: stage.awsStage,
    }
  },
})
