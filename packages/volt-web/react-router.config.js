// Volt's site is content, not an application: there is nothing per-request to render, and Volt runs no backend
// (openspec/changes/sell-cli-subscription). So we use React Router's framework mode WITHOUT a server —
// `ssr: false` + `prerender` compiles every route to static HTML at build time, and the output is plain files
// that Cloudflare serves from the edge. Same deployment shape as the Vite MPA this replaced (infra/www.ts is a
// StaticSite), but now with one router, one shared layout, and client-side navigation between pages.
//
// Flip `ssr: true` the day a route genuinely needs a request (a Polar webhook, a licence lookup). That is a
// config change plus a Worker in infra/www.ts — the routes themselves do not change.
export default {
  ssr: false,

  // Every URL that must exist as a file. A route missing here still works in the SPA, but has no HTML for
  // crawlers or a cold load — so this list IS the sitemap and must stay complete.
  // The feature pages are derived from content.js rather than typed out, so adding a feature can't 404.
  // Reduced to the single holding page — every other route is gone from routes.js too, so there is nothing
  // else to emit. This list IS the sitemap; restoring the site means restoring both.
  prerender: ["/"],
}
