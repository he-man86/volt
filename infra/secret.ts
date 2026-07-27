sst.Linkable.wrap(random.RandomPassword, (resource) => ({
  properties: {
    value: resource.result,
  },
}))

export const SECRET = {
  R2AccessKey: new sst.Secret("R2AccessKey", "unknown"),
  R2SecretKey: new sst.Secret("R2SecretKey", "unknown"),
  // Honeycomb takes TWO different keys that are NOT interchangeable, and both travel as HONEYCOMB_API_KEY —
  // this SST secret must keep that name because the vendored log-processor reads Resource.HONEYCOMB_API_KEY.
  // Its VALUE is the INGEST key (sent as X-Honeycomb-Team). The deploy-time CONFIGURATION key (which the
  // honeycombio provider needs for the recipient + triggers in infra/monitoring.ts) is not an SST secret at
  // all — it's process.env in the deploy step. deploy.yml keeps them apart by sourcing the two steps from
  // different GitHub secrets: HONEYCOMB_INGEST_KEY here, HONEYCOMB_CONFIG_KEY there. One key for both fails:
  // an ingest key can't manage recipients, and a configuration key can't ingest events.
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
