import { domain } from "./stage"

// Volt's public site — packages/volt-web, a React Router app in framework mode, at the apex.
//
// It used to sit at `www.${domain}` because the console held the apex, like opencode's. With the console and
// the gateway gone (openspec/changes/sell-cli-subscription) nothing else wants that hostname, so the site
// takes it. This is the ONLY thing Volt deploys.
//
// Still a StaticSite, even though React Router is a server framework: the app sets `ssr: false` and prerenders
// every route to HTML at build time (react-router.config.js), so the output is plain files. There is no Worker
// and no origin to run — consistent with Volt operating no backend.
//
// The day a route genuinely needs a request (a Polar webhook, a licence lookup), flip `ssr: true` there and
// swap this for `sst.cloudflare.ReactRouter`, which SST ships as a first-class component. The routes don't change.
export const www = new sst.cloudflare.StaticSite("Www", {
  path: "packages/volt-web",
  build: {
    command: "bun run build",
    // React Router splits its output: `build/client` is what gets served, `build/server` only drives the
    // prerender and is discarded. Pointing at `build/` would publish the server bundle.
    output: "build/client",
  },
  domain: { name: domain },
})
