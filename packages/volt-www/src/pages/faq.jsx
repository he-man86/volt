import { renderPage } from "../shell.jsx"
import { FAQ } from "../content.js"
import { PageHeader } from "../components/ui.jsx"
import { FinalCTA } from "../components/SocialProof.jsx"
import { Reveal } from "../reveal.jsx"

renderPage(
  <>
    <PageHeader eyebrow="FAQ" title="Questions, answered." />
    <section className="section container" style={{ maxWidth: 760 }}>
      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        {FAQ.map((f, i) => (
          <Reveal key={i} delayIndex={i % 3}>
            <details className="card">
              <summary style={{ cursor: "pointer", fontWeight: 600, listStyle: "none" }}>{f.q}</summary>
              <p className="muted" style={{ marginTop: "var(--space-3)", marginBottom: 0 }}>
                {f.a}
              </p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
    <FinalCTA />
  </>,
)
