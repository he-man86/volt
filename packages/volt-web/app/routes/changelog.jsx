import { CHANGELOG } from "../content.js"
import { PageHeader } from "../components/ui.jsx"
import { Reveal } from "../reveal.jsx"

export const meta = () => [
  { title: "Changelog — Volt" },
  { name: "description", content: "What's new in Volt — product updates, improvements, and fixes." },
]

export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Changelog" title="What's new in Volt." />
      <section className="section container" style={{ maxWidth: 760 }}>
        <div style={{ display: "grid", gap: "var(--space-6)" }}>
          {CHANGELOG.map((r, i) => (
            <Reveal key={r.version} delayIndex={i}>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "var(--space-4)" }}>
                <div>
                  <div className="h3">v{r.version}</div>
                  <div className="muted" style={{ fontSize: "var(--text-caption-size)" }}>
                    {r.date}
                  </div>
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                  {r.items.map((it) => (
                    <li key={it} className="muted" style={{ fontSize: "var(--text-small-size)" }}>
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
    </>
  )
}
