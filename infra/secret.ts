sst.Linkable.wrap(random.RandomPassword, (resource) => ({
  properties: {
    value: resource.result,
  },
}))

export const SECRET = {
  R2AccessKey: new sst.Secret("R2AccessKey", "unknown"),
  R2SecretKey: new sst.Secret("R2SecretKey", "unknown"),
  HoneycombApiKey: new sst.Secret("HONEYCOMB_API_KEY"),
  HoneycombWebhookSecret: new random.RandomPassword("HoneycombWebhookSecret", { length: 24 }),
  SupportApiKey: new sst.Secret("SUPPORT_API_KEY"),
  UpstashRedisRestUrl: new sst.Secret("UpstashRedisRestUrl"),
  UpstashRedisRestToken: new sst.Secret("UpstashRedisRestToken"),
  // Shared by the console app + the support portal (both read Resource.ZEN_LIMITS via console-core).
  ZenLimits: new sst.Secret("ZEN_LIMITS"),
  // Operator allow-list (comma-separated emails). Already the dev-login gate (auth worker env var); linked
  // to the console app too so the subscribe soft-launch gate can reuse the SAME list. Unset = subs closed on prod.
  ConsoleDevEmails: new sst.Secret("CONSOLE_DEV_EMAILS"),
}
