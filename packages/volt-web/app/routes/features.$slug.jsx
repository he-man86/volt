import { FEATURES } from "../content.js"
import { FeatureDetail } from "../components/FeatureDetail.jsx"
import { FinalCTA } from "../components/FinalCTA.jsx"

// One route for all six feature pages. The MPA had six near-identical .html files that each set
// `window.__FEATURE = "<slug>"` before booting React; the slug is now a real URL segment, so the page can be
// prerendered and deep-linked without a global.

// An unknown slug is a 404, not the first feature silently — a wrong link should be visible, not disguised.
// Prerendering runs this at BUILD time, so a feature listed in react-router.config.js but missing from
// content.js fails the build rather than shipping a broken page.
export function loader({ params }) {
  const feature = FEATURES.find((f) => f.slug === params.slug)
  if (!feature) throw new Response("Not found", { status: 404 })
  return { feature }
}

// Keyed off `params`, not the loader's `data`: in SPA mode (`ssr: false`) the prerenderer does not hand loader
// data to `meta`, so a data-driven title silently produced a page with NO <title> at all.
export const meta = ({ params }) => {
  const f = FEATURES.find((x) => x.slug === params.slug)
  return f ? [{ title: `${f.title} — Volt` }, { name: "description", content: f.blurb }] : []
}

export default function Page({ loaderData }) {
  return (
    <>
      <FeatureDetail feature={loaderData.feature} />
      <FinalCTA />
    </>
  )
}
