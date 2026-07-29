import { index, route } from "@react-router/dev/routes"

// Explicit routes rather than file-name conventions: the URL of every page is visible in one place, which is
// what the .html filenames used to give us. Keep this in step with `prerender` in react-router.config.js.
//
// URLs lost their `.html` in the move (`/pricing` → `/pricing`), and the six feature pages — six near
// identical HTML files that each set `window.__FEATURE` before booting — are now ONE route parameterised by
// slug, prerendered once per feature in content.js.
export default [
  index("routes/home.jsx"),
  route("pricing", "routes/pricing.jsx"),
  route("faq", "routes/faq.jsx"),
  route("docs", "routes/docs.jsx"),
  route("docs/desktop-vs-vscode", "routes/docs.desktop-vs-vscode.jsx"),
  route("contact", "routes/contact.jsx"),
  route("changelog", "routes/changelog.jsx"),
  route("features/:slug", "routes/features.$slug.jsx"),
  route("legal/terms", "routes/legal.terms.jsx"),
  route("legal/privacy", "routes/legal.privacy.jsx"),
  route("legal/cookies", "routes/legal.cookies.jsx"),
]
