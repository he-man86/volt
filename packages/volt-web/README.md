# @volt/web

Volt's public website — [React Router] in framework mode, prerendered to static HTML.

```bash
bun run dev        # http://localhost:5173, hot reload
bun run build      # -> build/client (what gets deployed) + build/server (prerender only, discarded)
bun run preview    # serve the built output exactly as production will
bun test           # unit tests (currently reveal.test.js)
```

Deployed by `infra/www.ts` at the apex domain. It is the only thing Volt deploys.

## Why a server framework for a static site

The site has no backend and Volt runs none — so `react-router.config.js` sets **`ssr: false`** and lists every
URL under **`prerender`**. Each route is rendered to HTML at build time and served as a plain file; no Worker,
no origin. What React Router buys us over the plain Vite MPA this replaced is one `<head>`, one layout, one
place that lists the URLs, and client-side navigation between pages.

**`prerender` is the sitemap.** A route missing from that list still works once the app has booted, but has no
HTML for a crawler or a cold load. Add the route _and_ the URL. The six feature pages are generated from
`FEATURES` in `content.js`, so adding a feature can't 404.

The day a route genuinely needs a request — a Polar webhook, a licence check — set `ssr: true`, drop that
route's entry from `prerender`, and switch `infra/www.ts` to `sst.cloudflare.ReactRouter`. The routes themselves
don't change. That is the whole reason this is a router app and not a folder of HTML files.

## Layout

```
app/
  root.jsx          the document: <head>, Nav, <Outlet/>, Footer, ErrorBoundary (renders the 404)
  routes.js         URL -> module. Explicit, not file-name conventions
  routes/           one module per page: `export default` is the body, `export const meta` the <title>
  components/       UI, each with its stylesheet beside it (Nav.jsx + nav.css)
  components/mockups/  the interactive product mockups on the home page
  docs/*.mdx        long-form docs prose, rendered by routes/docs*.jsx
  content.js        ALL copy — nav, features, pricing, FAQ, footer
  config.js         the two external URLs (installer, checkout) and the COMING_SOON switch
  styles.css        tokens + reset + shared primitives (.container/.btn/.card)
react-router.config.js   ssr:false + the prerender list
```

### Adding a page

1. `app/routes/thing.jsx` — default-export the body, export `meta` for the `<title>` and description.
2. `app/routes.js` — `route("thing", "routes/thing.jsx")`.
3. `react-router.config.js` — add `"/thing"` to `prerender`.
4. Link to it from `NAV`/`FOOTER` in `content.js` if it should be reachable.

Step 4 is not optional bookkeeping: the six feature pages existed in the old site with **nothing linking to
them**, which is how they went stale unnoticed.

### Links

Use `<Link to>` for Volt's own pages so navigation stays client-side, and a plain `<a href>` for anything
off-site. `Button` and `SiteLink` in `components/ui.jsx` pick for you based on whether the destination starts
with `/` — prefer those where the destination comes from `content.js` and might turn external later.

Prose links inside `docs/*.mdx` are plain anchors and cause a full page load. That's fine for a documentation
footer; wire up an MDX component map if it ever stops being fine.

## The commercial surface is CLOSED

`config.js` exports **`COMING_SOON = true`**. While it's set, `downloadUrl()` and `checkoutUrl()` return `null`
and every CTA renders a disabled _"Coming soon"_ control instead of a link — a dead link is worse than an honest
one. To open it:

- **Download** — publish the installer to GitHub Releases, then set `COMING_SOON = false`.
- **Buy** — create the Polar product, set `VITE_CHECKOUT_URL` to its checkout link
  (`openspec/changes/sell-cli-subscription`).

There is no sign-in and no dashboard. The console was deleted along with the AI gateway; the licence key is the
credential and billing lives in Polar's own portal.

## Known-stale content

**The three pages under `app/routes/legal.*.jsx` are wrong.** They describe a hosted AI gateway, user accounts
and Stripe as the payment processor — none of which exist. They are contracts, so they need a real pass before
Volt takes money (tracked as task 4b in `openspec/changes/sell-cli-subscription`). Nothing is purchasable yet,
which makes them premature rather than actively misleading.

Everything else — home, pricing, FAQ, docs, features — was corrected when the gateway was removed.

## Content lives in `content.js`

Copy is data, not JSX. Editing pricing, the nav, the FAQ or the footer means editing `content.js`; the
components render whatever is there. `FEATURES` in particular drives three things at once — the home grid, the
`/features/:slug` routes, and the prerender list.

[React Router]: https://reactrouter.com
