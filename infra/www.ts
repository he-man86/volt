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
    // Apex, with `www.` → apex redirect. The redirect uses a Cloudflare Page Rule, so the deploy token must be
    // scoped for Zone → Page Rules → Edit. (Drop `redirects` for apex-only if that permission isn't available.)
    domain: { name: domain, redirects: [`www.${domain}`] },
    environment: {
      VITE_CONSOLE_URL: `https://${consoleDomain}`,
    },
  },
  { dependsOn: [web] },
)
