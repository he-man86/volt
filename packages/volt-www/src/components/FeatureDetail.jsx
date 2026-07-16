// Feature detail page body. The HTML sets window.FEATURE = "<slug>"; we look it up in content.FEATURES.
import { FEATURES } from "../content.js"
import { PageHeader, Button, Arrow } from "./ui.jsx"
import { Reveal } from "../reveal.jsx"

export function FeatureDetail() {
  const slug = typeof window !== "undefined" ? window.__FEATURE : null
  const f = FEATURES.find((x) => x.slug === slug) ?? FEATURES[0]
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
          <a href="/#features" className="btn btn-secondary btn-lg">
            All features <Arrow />
          </a>
        </div>
      </section>
    </>
  )
}
