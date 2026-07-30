import { index } from "@react-router/dev/routes"

// REDUCED to a single holding page while Volt is pre-release (see routes/holding.jsx). The full route table —
// pricing, faq, docs, contact, changelog, features/:slug and the three legal pages — is removed rather than
// hidden, so those URLs 404 instead of serving stale storefront copy. Restore by reverting that commit; keep this
// in step with `prerender` in react-router.config.js.
export default [index("routes/holding.jsx")]
