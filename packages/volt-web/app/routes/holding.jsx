// The landing page while Volt is pre-release: this plus the docs pages are the whole route set (`routes.js`,
// `prerender` in react-router.config.js). The storefront routes — pricing, features, legal, changelog — are
// removed, so those URLs 404 rather than serving stale claims about a product that isn't buyable yet.
export function meta() {
  return [
    { title: "Volt" },
    { name: "description", content: "Volt — PLC code as version-controllable text. Coming soon." },
    // Nothing here is worth indexing yet, and a half-page ranking now is worse than no page.
    { name: "robots", content: "noindex" },
  ]
}

export default function Holding() {
  return (
    <main className="holding">
      <h1>Volt</h1>
      <p>PLC projects as version-controllable text — for CODESYS and TwinCAT.</p>
      <p className="holding-soon">Coming soon.</p>
    </main>
  )
}
