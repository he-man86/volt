import { index, route } from "@react-router/dev/routes"

// REDUCED to the holding page + DOCS while Volt is pre-release (see routes/holding.jsx). The storefront routes —
// pricing, faq, contact, changelog, features/:slug and the three legal pages — stay removed rather than hidden,
// so those URLs 404 instead of serving stale copy. Docs are back because they are the one thing a user needs the
// moment they install: how to connect the IDE, and how to reach Volt from their AI agent. Keep this in step with
// `prerender` in react-router.config.js — a route missing there has no HTML for a crawler or a cold load.
export default [
  index("routes/holding.jsx"),
  route("docs", "routes/docs.jsx"),
  route("docs/agents", "routes/docs.agents.jsx"),
  route("docs/desktop-vs-vscode", "routes/docs.desktop-vs-vscode.jsx"),
]
