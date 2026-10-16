import { Reveal } from "../reveal.jsx"
import { Button, Arrow } from "./ui.jsx"
import { FINAL_CTA } from "../content.js"

// Reusable closing CTA band.
export function FinalCTA() {
  return (
    <section className="section container container-wide">
      <Reveal>
        <div className="card" style={{ textAlign: "center", padding: "var(--space-9)" }}>
          <h2 className="h2" style={{ maxWidth: 520, marginInline: "auto" }}>
            {FINAL_CTA.title}
          </h2>
          <p className="lead" style={{ marginTop: "var(--space-3)" }}>
            {FINAL_CTA.lead}
          </p>
          <div
            style={{
              display: "flex",
              gap: "var(--space-3)",
              justifyContent: "center",
              marginTop: "var(--space-5)",
              flexWrap: "wrap",
            }}
          >
            <Button kind="download" variant="primary" size="lg">
              Download for Windows
            </Button>
            <Button href="/docs" variant="secondary" size="lg">
              Read the docs <Arrow />
            </Button>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
