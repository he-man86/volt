// TODO(volt): set your domain + Cloudflare zone ID.
//   1. Register/move your domain onto Cloudflare.
//   2. Replace "volt.example" below with your real domain (prod + dev subdomains).
//   3. Replace VOLT_CLOUDFLARE_ZONE_ID with the zone ID from the Cloudflare dashboard (Overview → API → Zone ID).
export const domain = (() => {
  if ($app.stage === "production") return "volt.example" // TODO(volt): production domain
  if ($app.stage === "dev") return "dev.volt.example" // TODO(volt): dev subdomain
  return `${$app.stage}.dev.volt.example`
})()

export const zoneID = "VOLT_CLOUDFLARE_ZONE_ID" // TODO(volt): Cloudflare zone ID for the domain above
export const awsStage = $app.stage === "production" ? "production" : "dev"
export const deployAws = $app.stage === awsStage

new cloudflare.RegionalHostname("RegionalHostname", {
  hostname: domain,
  regionKey: "us",
  zoneId: zoneID,
})
