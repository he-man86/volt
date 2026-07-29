// Volt's domain per stage. `production` → volt-ai.dev, `dev` → dev.volt-ai.dev, anything else → a personal
// sandbox under dev.
export const domain = (() => {
  if ($app.stage === "production") return "volt-ai.dev"
  if ($app.stage === "dev") return "dev.volt-ai.dev"
  return `${$app.stage}.dev.volt-ai.dev`
})()

// Cloudflare Zone ID for volt-ai.dev.
export const zoneID = "ebac4f049c913d03ae11f89114379d6c"
