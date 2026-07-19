import { Reveal } from "../reveal.jsx"
import { Button, Arrow } from "./ui.jsx"

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
