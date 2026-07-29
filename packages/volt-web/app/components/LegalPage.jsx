// Shared legal-page layout. Each legal page passes its title/updated/sections; content stays in the page file so
// counsel edits prose, not layout.
import { PageHeader } from "./ui.jsx"

export function LegalPage({ title, updated, notice, sections }) {
  return (
    <>
      <PageHeader eyebrow="Legal" title={title} lead={`Last updated ${updated}`} />
      <section className="container" style={{ maxWidth: 740, paddingBottom: "var(--space-10)" }}>
        {notice && (
          <div
            className="card"
            style={{
              background: "color-mix(in srgb, var(--color-accent) 6%, transparent)",
              marginBottom: "var(--space-6)",
            }}
          >
            <p style={{ margin: 0, fontSize: "var(--text-small-size)" }} className="muted">
              <strong style={{ color: "var(--text-body)" }}>Pending review.</strong> {notice}
            </p>
          </div>
        )}
        {sections.map(([heading, body, bullets]) => (
          <div key={heading} style={{ marginBottom: "var(--space-5)" }}>
            <h2 className="h3" style={{ marginBottom: "var(--space-2)" }}>
              {heading}
            </h2>
            <p className="muted" style={{ margin: 0, fontSize: "var(--text-small-size)" }}>
              {body}
            </p>
            {bullets && (
              <ul style={{ margin: "var(--space-2) 0 0", paddingLeft: 22 }}>
                {bullets.map((b) => (
                  <li key={b} className="muted" style={{ fontSize: "var(--text-small-size)", marginBottom: 4 }}>
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>
    </>
  )
}
