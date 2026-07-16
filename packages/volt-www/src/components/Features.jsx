import { FEATURES } from "../content.js"
import { Reveal } from "../reveal.jsx"

export function Features() {
  return (
    <section id="features" className="section container container-wide">
      <Reveal>
        <div className="eyebrow">Built for PLC engineering</div>
        <h2 className="h2" style={{ marginTop: "var(--space-2)", maxWidth: 640 }}>
          Not a generic code tool with a PLC skin.
        </h2>
        <p className="lead" style={{ marginTop: "var(--space-3)", maxWidth: 560 }}>
          Volt understands your project the way your compiler does — down to the Structured Text.
        </p>
      </Reveal>
      <div className="feature-grid" style={{ marginTop: "var(--space-7)" }}>
        {FEATURES.map((f, i) => (
          <Reveal key={f.slug} delayIndex={i % 3}>
            <div className="card feature-card" style={{ height: "100%" }}>
              <div className="eyebrow">{f.eyebrow}</div>
              <div className="h3">{f.title}</div>
              <p className="muted" style={{ fontSize: "var(--text-small-size)", margin: 0, flex: 1 }}>
                {f.blurb}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
