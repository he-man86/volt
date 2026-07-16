import { renderPage } from "../shell.jsx"
import { FeatureDetail } from "../components/FeatureDetail.jsx"
import { FinalCTA } from "../components/SocialProof.jsx"

// Shared entry for all feature-*.html pages. Each HTML sets window.__FEATURE = "<slug>" before this module loads.
renderPage(
  <>
    <FeatureDetail />
    <FinalCTA />
  </>,
)
