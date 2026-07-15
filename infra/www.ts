import { domain } from "./stage"

// Volt's public marketing site — a static Vite build (packages/volt-www) served at `www.${domain}`. The console
// keeps the apex (like opencode — its domain never moves), so there is NO domain handover: this is a fresh
// StaticSite on a new hostname (SST creates the `www.` DNS record + Workers custom domain with the existing token).
// Its CTAs link across to the console at the apex via VITE_CONSOLE_URL, baked in at build time here.
export const www = new sst.cloudflare.StaticSite("Www", {
  path: "packages/volt-www",
  build: {
    command: "bun run build",
    output: "dist",
  },
  domain: { name: `www.${domain}` },
  environment: {
    VITE_CONSOLE_URL: `https://${domain}`,
  },
})
