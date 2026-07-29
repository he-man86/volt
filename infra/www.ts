import { domain } from "./stage"

// Volt's public site — a static Vite build (packages/volt-www) at the apex.
//
// It used to sit at `www.${domain}` because the console held the apex, like opencode's. With the console and
// the gateway gone (openspec/changes/sell-cli-subscription) nothing else wants that hostname, so the marketing
// site takes it. `VITE_CONSOLE_URL` went with the console — the buy CTA links to Polar checkout instead, which
// is an external URL and belongs in the site's own content, not in infra.
//
// This is now the ONLY thing Volt deploys.
export const www = new sst.cloudflare.StaticSite("Www", {
  path: "packages/volt-www",
  build: {
    command: "bun run build",
    output: "dist",
  },
  domain: { name: domain },
})
