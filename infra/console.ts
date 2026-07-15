import { domain } from "./stage"
import { EMAILOCTOPUS_API_KEY } from "./app"
import { SECRET } from "./secret"

////////////////
// DATABASE
////////////////

const cluster = planetscale.getDatabaseOutput({
  name: "volt",
  organization: "mheijmans",
})

const branch =
  // Volt's `volt` DB uses PlanetScale's default `main` as the production branch (not a branch named
  // "production" as opencode assumed). Production stage → use `main` directly; other stages fork from it.
  $app.stage === "production"
    ? planetscale.getBranchOutput({
        name: "main",
        organization: cluster.organization,
        database: cluster.name,
      })
    : new planetscale.Branch("DatabaseBranch", {
        database: cluster.name,
        organization: cluster.organization,
        name: $app.stage,
        parentBranch: "main",
      })
const password = new planetscale.Password("DatabasePassword", {
  name: $app.stage,
  database: cluster.name,
  organization: cluster.organization,
  branch: branch.name,
})

export const database = new sst.Linkable("Database", {
  properties: {
    host: password.accessHostUrl,
    database: cluster.name,
    username: password.username,
    password: password.plaintext,
    port: 3306,
  },
})

new sst.x.DevCommand("Studio", {
  link: [database],
  dev: {
    command: "bun db studio",
    directory: "packages/console/core",
    autostart: true,
  },
})

////////////////
// AUTH
////////////////

const GITHUB_CLIENT_ID_CONSOLE = new sst.Secret("GITHUB_CLIENT_ID_CONSOLE")
const GITHUB_CLIENT_SECRET_CONSOLE = new sst.Secret("GITHUB_CLIENT_SECRET_CONSOLE")
const GOOGLE_CLIENT_ID = new sst.Secret("GOOGLE_CLIENT_ID")
const authStorage = new sst.cloudflare.Kv("AuthStorage")
export const auth = new sst.cloudflare.Worker("AuthApi", {
  domain: `auth.${domain}`,
  handler: "packages/console/function/src/auth.ts",
  url: true,
  environment: {
    // Dev-only login allowlist (comma-separated emails / @domains). Empty = open. Ignored on production.
    CONSOLE_DEV_EMAILS: process.env.CONSOLE_DEV_EMAILS ?? "",
  },
  link: [database, authStorage, GITHUB_CLIENT_ID_CONSOLE, GITHUB_CLIENT_SECRET_CONSOLE, GOOGLE_CLIENT_ID],
})

////////////////
// GATEWAY (Stripe)
////////////////
// TODO(volt): this whole section is opencode's Zen product shape (a "Go" plan @ $10/mo + a "Black" tier +
// coupons). On deploy it CREATES these products/prices in your Stripe account. For the first deploy it gives you
// a working placeholder product so the signup→checkout loop works; replace with Volt's real product/pricing in
// the adapt stage. console/app reads ZEN_LITE_PRICE / ZEN_BLACK_PRICE, so keep those linkables until then.

export const stripeWebhook = new stripe.WebhookEndpoint("StripeWebhookEndpoint", {
  // Console (+ its /stripe/webhook route) serves the apex. (Domain split to app.${consoleDomain} is deferred.)
  url: $interpolate`https://${domain}/stripe/webhook`,
  enabledEvents: [
    "checkout.session.async_payment_failed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.completed",
    "checkout.session.expired",
    "charge.refunded",
    "invoice.payment_succeeded",
    "invoice.payment_failed",
    "invoice.payment_action_required",
    "customer.created",
    "customer.deleted",
    "customer.updated",
    "customer.discount.created",
    "customer.discount.deleted",
    "customer.discount.updated",
    "customer.source.created",
    "customer.source.deleted",
    "customer.source.expiring",
    "customer.source.updated",
    "customer.subscription.created",
    "customer.subscription.deleted",
    "customer.subscription.paused",
    "customer.subscription.pending_update_applied",
    "customer.subscription.pending_update_expired",
    "customer.subscription.resumed",
    "customer.subscription.trial_will_end",
    "customer.subscription.updated",
  ],
})

const zenLiteProduct = new stripe.Product("ZenLite", {
  name: "Volt Gateway", // the Volt gateway subscription (opencode's "Go"/lite plan)
})
const zenLiteCouponFirstMonth50 = new stripe.Coupon("ZenLiteCouponFirstMonth50", {
  name: "First month 50% off",
  percentOff: 50,
  appliesTos: [zenLiteProduct.id],
  duration: "once",
})
const zenLiteCouponFirstMonth100 = new stripe.Coupon("ZenLiteCouponFirstMonth100", {
  name: "First month 100% off",
  percentOff: 100,
  appliesTos: [zenLiteProduct.id],
  duration: "once",
})
const zenLiteCouponThreeMonths100 = new stripe.Coupon("ZenLiteCoupon3Months100", {
  name: "3 months 100% off",
  percentOff: 100,
  appliesTos: [zenLiteProduct.id],
  duration: "repeating",
  durationInMonths: 3,
})
const zenLiteCouponSixMonths100 = new stripe.Coupon("ZenLiteCoupon6Months100", {
  name: "6 months 100% off",
  percentOff: 100,
  appliesTos: [zenLiteProduct.id],
  duration: "repeating",
  durationInMonths: 6,
})
const zenLiteCouponTwelveMonths100 = new stripe.Coupon("ZenLiteCoupon12Months100", {
  name: "12 months 100% off",
  percentOff: 100,
  appliesTos: [zenLiteProduct.id],
  duration: "repeating",
  durationInMonths: 12,
})
const zenLitePrice = new stripe.Price("ZenLitePrice", {
  product: zenLiteProduct.id,
  currency: "eur", // Volt Gateway — priced in euros
  recurring: {
    interval: "month",
    intervalCount: 1,
  },
  unitAmount: 2400, // €24/month
})
const ZEN_LITE_PRICE = new sst.Linkable("ZEN_LITE_PRICE", {
  properties: {
    product: zenLiteProduct.id,
    price: zenLitePrice.id,
    priceInr: 92900,
    firstMonth50Coupon: zenLiteCouponFirstMonth50.id,
    firstMonth100Coupon: zenLiteCouponFirstMonth100.id,
    threeMonths100Coupon: zenLiteCouponThreeMonths100.id,
    sixMonths100Coupon: zenLiteCouponSixMonths100.id,
    twelveMonths100Coupon: zenLiteCouponTwelveMonths100.id,
  },
})

const zenBlackProduct = new stripe.Product("ZenBlack", {
  name: "OpenCode Black", // Black is unused — Volt only sells the Gateway plan — so this stays 100% opencode (unbranded, never shown to Volt users)
})
const zenBlackPriceProps = {
  product: zenBlackProduct.id,
  currency: "usd",
  recurring: {
    interval: "month",
    intervalCount: 1,
  },
}
const zenBlackPrice200 = new stripe.Price("ZenBlackPrice", { ...zenBlackPriceProps, unitAmount: 20000 })
const zenBlackPrice100 = new stripe.Price("ZenBlack100Price", { ...zenBlackPriceProps, unitAmount: 10000 })
const zenBlackPrice20 = new stripe.Price("ZenBlack20Price", { ...zenBlackPriceProps, unitAmount: 2000 })
const ZEN_BLACK_PRICE = new sst.Linkable("ZEN_BLACK_PRICE", {
  properties: {
    product: zenBlackProduct.id,
    plan200: zenBlackPrice200.id,
    plan100: zenBlackPrice100.id,
    plan20: zenBlackPrice20.id,
  },
})

const ZEN_MODELS = [
  new sst.Secret("ZEN_MODELS1"),
  new sst.Secret("ZEN_MODELS2"),
  new sst.Secret("ZEN_MODELS3"),
  new sst.Secret("ZEN_MODELS4"),
  new sst.Secret("ZEN_MODELS5"),
  new sst.Secret("ZEN_MODELS6"),
  new sst.Secret("ZEN_MODELS7"),
  new sst.Secret("ZEN_MODELS8"),
  new sst.Secret("ZEN_MODELS9"),
  new sst.Secret("ZEN_MODELS10"),
  new sst.Secret("ZEN_MODELS11"),
  new sst.Secret("ZEN_MODELS12"),
  new sst.Secret("ZEN_MODELS13"),
  new sst.Secret("ZEN_MODELS14"),
  new sst.Secret("ZEN_MODELS15"),
  new sst.Secret("ZEN_MODELS16"),
  new sst.Secret("ZEN_MODELS17"),
  new sst.Secret("ZEN_MODELS18"),
  new sst.Secret("ZEN_MODELS19"),
  new sst.Secret("ZEN_MODELS20"),
  new sst.Secret("ZEN_MODELS21"),
  new sst.Secret("ZEN_MODELS22"),
  new sst.Secret("ZEN_MODELS23"),
  new sst.Secret("ZEN_MODELS24"),
  new sst.Secret("ZEN_MODELS25"),
  new sst.Secret("ZEN_MODELS26"),
  new sst.Secret("ZEN_MODELS27"),
  new sst.Secret("ZEN_MODELS28"),
  new sst.Secret("ZEN_MODELS29"),
  new sst.Secret("ZEN_MODELS30"),
]
const STRIPE_SECRET_KEY = new sst.Secret("STRIPE_SECRET_KEY")
const STRIPE_PUBLISHABLE_KEY = new sst.Secret("STRIPE_PUBLISHABLE_KEY")
const AUTH_API_URL = new sst.Linkable("AUTH_API_URL", {
  properties: { value: auth.url.apply((url) => url!) },
})
const STRIPE_WEBHOOK_SECRET = new sst.Linkable("STRIPE_WEBHOOK_SECRET", {
  properties: { value: stripeWebhook.secret },
})

////////////////
// CONSOLE
////////////////

const bucket = new sst.cloudflare.Bucket("ZenData")
const bucketNew = new sst.cloudflare.Bucket("ZenDataNew")

const DISCORD_INCIDENT_WEBHOOK_URL = new sst.Secret("DISCORD_INCIDENT_WEBHOOK_URL")
const AWS_SES_ACCESS_KEY_ID = new sst.Secret("AWS_SES_ACCESS_KEY_ID")
const AWS_SES_SECRET_ACCESS_KEY = new sst.Secret("AWS_SES_SECRET_ACCESS_KEY")

const SALESFORCE_CLIENT_ID = new sst.Secret("SALESFORCE_CLIENT_ID")
const SALESFORCE_CLIENT_SECRET = new sst.Secret("SALESFORCE_CLIENT_SECRET")
const SALESFORCE_INSTANCE_URL = new sst.Secret("SALESFORCE_INSTANCE_URL")

const logProcessor = new sst.cloudflare.Worker("LogProcessor", {
  handler: "packages/console/function/src/log-processor.ts",
  link: [SECRET.HoneycombApiKey],
})

export const web = new sst.cloudflare.x.SolidStart("Console", {
  domain, // the apex, for now (the console→app.${domain} split ships with volt-www — deferred; see sst.config.ts)
  path: "packages/console/app",
  link: [
    bucket,
    bucketNew,
    database,
    SECRET.UpstashRedisRestUrl,
    SECRET.UpstashRedisRestToken,
    AUTH_API_URL,
    STRIPE_WEBHOOK_SECRET,
    SECRET.SupportApiKey,
    DISCORD_INCIDENT_WEBHOOK_URL,
    SECRET.HoneycombWebhookSecret,
    STRIPE_SECRET_KEY,
    EMAILOCTOPUS_API_KEY,
    AWS_SES_ACCESS_KEY_ID,
    AWS_SES_SECRET_ACCESS_KEY,
    SALESFORCE_CLIENT_ID,
    SALESFORCE_CLIENT_SECRET,
    SALESFORCE_INSTANCE_URL,
    ZEN_BLACK_PRICE,
    ZEN_LITE_PRICE,
    new sst.Secret("ZEN_LIMITS"),
    new sst.Secret("ZEN_SESSION_SECRET"),
    ...ZEN_MODELS,
    ...($dev
      ? [
          new sst.Secret("CLOUDFLARE_DEFAULT_ACCOUNT_ID", process.env.CLOUDFLARE_DEFAULT_ACCOUNT_ID!),
          new sst.Secret("CLOUDFLARE_API_TOKEN", process.env.CLOUDFLARE_API_TOKEN!),
        ]
      : []),
  ],
  environment: {
    //VITE_DOCS_URL: web.url.apply((url) => url!),
    //VITE_API_URL: gateway.url.apply((url) => url!),
    VITE_AUTH_URL: auth.url.apply((url) => url!),
    VITE_STRIPE_PUBLISHABLE_KEY: STRIPE_PUBLISHABLE_KEY.value,
  },
  transform: {
    server: {
      placement: { region: "aws:us-east-2" },
      transform: {
        worker: {
          // Tail Workers require the Workers Paid plan. This pipeline only feeds monitoring, which is gated on
          // HONEYCOMB_API_KEY — so on the Free plan (monitoring deferred) we skip the tail consumer and deploy.
          tailConsumers: process.env.HONEYCOMB_API_KEY ? [{ service: logProcessor.nodes.worker.scriptName }] : [],
        },
      },
    },
  },
})

////////////////
// HELPERS
////////////////

export const stat = new sst.cloudflare.Worker("Stat", {
  handler: "packages/console/function/src/stat.ts",
  link: [database],
  url: true,
})
