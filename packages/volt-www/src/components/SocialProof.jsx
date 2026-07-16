import { TESTIMONIALS } from "../content.js"
import { Reveal } from "../reveal.jsx"
import { Button, Arrow } from "./ui.jsx"

export function SocialProof() {
  return (
    <section className="section container container-wide">
      <Reveal>
        <div className="strip-dark">
          <div className="eyebrow" style={{ color: "var(--color-accent)" }}>
            From the shop floor
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "var(--space-6)",
              marginTop: "var(--space-6)",
            }}
            className="feature-grid"
          >
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={i} delayIndex={i}>
                <figure style={{ margin: 0 }}>
                  <blockquote className="serif" style={{ margin: 0, fontSize: "20px", lineHeight: 1.4 }}>
                    “{t.quote}”
                  </blockquote>
                  <figcaption className="muted" style={{ marginTop: "var(--space-3)", fontSize: "var(--text-small-size)" }}>
                    {t.name} · {t.org}
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  )
}

// Reusable closing CTA band.
export function FinalCTA() {
  return (
    <section className="section container container-wide">
      <Reveal>
        <div className="card" style={{ textAlign: "center", padding: "var(--space-9)" }}>
          <h2 className="h2" style={{ maxWidth: 520, marginInline: "auto" }}>
            Bring your PLC project into the modern workflow.
          </h2>
          <p className="lead" style={{ marginTop: "var(--space-3)" }}>
            Free with your own AI provider. Windows.
          </p>
          <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "center", marginTop: "var(--space-5)", flexWrap: "wrap" }}>
            <Button kind="download" variant="primary" size="lg">
              Download for Windows
            </Button>
            <Button kind="auth" variant="secondary" size="lg">
              Get started <Arrow />
            </Button>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
