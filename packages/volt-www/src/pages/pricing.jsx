import { renderPage } from "../shell.jsx"
import { PRICING } from "../content.js"
import { PageHeader, Button, ctaHref } from "../components/ui.jsx"
import { FinalCTA } from "../components/FinalCTA.jsx"
import { Reveal } from "../reveal.jsx"

function Plan({ p, i }) {
  return (
    <Reveal delayIndex={i}>
      <div
        className="card"
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          borderColor: p.featured ? "var(--color-ink)" : undefined,
          borderWidth: p.featured ? 2 : 1,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <div className="h3">{p.name}</div>
            {p.beta && (
              <span
                style={{
                  fontSize: "var(--text-small-size)",
                  fontWeight: 600,
                  lineHeight: 1,
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: "1px solid var(--color-accent)",
                  color: "var(--color-accent)",
                  letterSpacing: "0.02em",
                  whiteSpace: "nowrap",
                }}
              >
                Public beta
              </span>
            )}
          </div>
          <div className="muted" style={{ fontSize: "var(--text-small-size)" }}>
            {p.note}
          </div>
        </div>
        <div style={{ fontSize: "var(--text-h2-size)", fontWeight: 600 }}>
          {p.price}
          {p.period && <span className="muted" style={{ fontSize: "var(--text-body-size)", fontWeight: 400 }}> {p.period}</span>}
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-2)", flex: 1 }}>
          {p.features.map((f) => (
            <li key={f} style={{ display: "flex", gap: 8, fontSize: "var(--text-small-size)" }}>
              <span style={{ color: "var(--color-accent)" }}>✓</span>
              {f}
            </li>
          ))}
        </ul>
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          <Button kind={p.kind} variant={p.featured ? "primary" : "secondary"} href={p.kind === "contact" ? ctaHref("contact") : undefined}>
            {p.cta}
          </Button>
          {p.betaNote && (
            <div className="muted" style={{ fontSize: "var(--text-small-size)", textAlign: "center" }}>
              {p.betaNote}
            </div>
          )}
        </div>
      </div>
    </Reveal>
  )
}

renderPage(
  <>
    <PageHeader eyebrow="Pricing" title="Start free. Bring your own AI." lead="The tooling is free with your own model provider. Pro adds hosted AI — and it's in public beta right now: sign up free, no card required." />
    <section className="section container" style={{ maxWidth: 720 }}>
      <div className="pricing-grid">
        {PRICING.map((p, i) => (
          <Plan key={p.name} p={p} i={i} />
        ))}
      </div>
    </section>
    <FinalCTA />
  </>,
)
