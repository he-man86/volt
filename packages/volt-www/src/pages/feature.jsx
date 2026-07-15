import { renderPage } from "../shell.jsx"

// Shared entry for all feature-*.html pages. Each HTML sets window.__FEATURE = "<slug>" (an inline script before
// this module), and FeaturePage reads it at render to pick its content.
renderPage(() => {
  const { FeaturePage, FinalCTA } = window
  return (
    <>
      <FeaturePage />
      <FinalCTA />
    </>
  )
})
