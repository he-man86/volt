// Domain: volt-ai.dev (prod), dev.volt-ai.dev (dev), <stage>.dev.volt-ai.dev (other stages).
export const domain = (() => {
  if ($app.stage === "production") return "volt-ai.dev"
  if ($app.stage === "dev") return "dev.volt-ai.dev"
  return `${$app.stage}.dev.volt-ai.dev`
})()

// Cloudflare Zone ID for volt-ai.dev.
export const zoneID = "ebac4f049c913d03ae11f89114379d6c"
export const awsStage = $app.stage === "production" ? "production" : "dev"
export const deployAws = $app.stage === awsStage

// (opencode pinned the domain to a US RegionalHostname — Cloudflare's Data Localization Suite, a paid add-on.
// Volt doesn't need data-residency pinning, and requiring it forced a "Regional Services" token permission most
// accounts don't have. Dropped. Re-add `new cloudflare.RegionalHostname(...)` here if EU/US residency is ever needed.)
