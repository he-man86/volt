// The site is deliberately reduced to ONE page while Volt is pre-release. Everything else — pricing, features,
// docs, legal, changelog — is removed from `routes.js` and from `prerender` in react-router.config.js, so those
// URLs no longer exist rather than serving stale claims about a product that isn't buyable yet.
// To restore the full site: git revert this commit. DNS and TLS are untouched; only the route set changed.
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
