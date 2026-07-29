// Feature detail page body. The feature comes from the route's loader (routes/features.$slug.jsx) — it used to
// be read off `window.__FEATURE`, which meant the page could not render without a browser.
import { Link } from "react-router"
import { PageHeader, Button, Arrow } from "./ui.jsx"
import { Reveal } from "../reveal.jsx"

export function FeatureDetail({ feature: f }) {
  return (
    <>
      <PageHeader eyebrow={f.eyebrow} title={f.title} lead={f.blurb} />
      <section className="section container" style={{ maxWidth: 760 }}>
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          {f.points.map((p, i) => (
            <Reveal key={i} delayIndex={i}>
              <div className="card" style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
                <span style={{ color: "var(--color-accent)", fontWeight: 700 }}>—</span>
                <span>{p}</span>
              </div>
            </Reveal>
          ))}
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-7)", flexWrap: "wrap" }}>
          <Button kind="download" variant="primary" size="lg">
            Download for Windows
          </Button>
          <Link to="/#features" className="btn btn-secondary btn-lg">
            All features <Arrow />
          </Link>
        </div>
      </section>
    </>
  )
}
