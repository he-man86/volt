import { domain, consoleDomain } from "./stage"

// Volt's public marketing site — a static Vite build (packages/volt-www) served at the APEX domain, with the
// `www.` host redirecting to it. This is Volt-owned (not the vendored console); its CTAs link across to the
// console (auth/dashboard) via VITE_CONSOLE_URL, baked in at build time here.
//
// Cloudflare StaticSite: `build.command` runs in `path` and the `build.output` dir is uploaded to KV, fronted by
// a Worker on the domain. `bun install` (the deploy job) provides the deps before the build runs.
export const www = new sst.cloudflare.StaticSite("Www", {
  path: "packages/volt-www",
  build: {
    command: "bun run build",
    output: "dist",
  },
  domain: {
    name: domain,
    redirects: [`www.${domain}`], // www.* → apex
  },
  environment: {
    VITE_CONSOLE_URL: `https://${consoleDomain}`,
  },
})
