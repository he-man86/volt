import { domain, consoleDomain } from "./stage"
import { web } from "./console"

// Volt's public marketing site — a static Vite build (packages/volt-www) served at the APEX domain. This is
// Volt-owned (not the vendored console); its CTAs link across to the console (auth/dashboard) via VITE_CONSOLE_URL,
// baked in at build time here.
//
// Cloudflare StaticSite: `build.command` runs in `path` and the `build.output` dir is uploaded to KV, fronted by a
// Worker on the domain. `bun install` (the deploy job) provides the deps before the build runs.
//
// dependsOn the console: the console is moving OFF the apex (→ app.${domain}) in this same deploy. Www can only
// claim the apex once the console has vacated it, so it must apply after the console (else CF 409s the domain).
export const www = new sst.cloudflare.StaticSite(
  "Www",
  {
    path: "packages/volt-www",
    build: {
      command: "bun run build",
      output: "dist",
    },
    // Apex only. (A `www.` → apex redirect would need SST's Page Rule, i.e. the deploy token scoped for
    // Zone → Page Rules → Edit — add `redirects: [\`www.${domain}\`]` here if/when you want it.)
    domain: { name: domain },
    environment: {
      VITE_CONSOLE_URL: `https://${consoleDomain}`,
    },
  },
  { dependsOn: [web] },
)
