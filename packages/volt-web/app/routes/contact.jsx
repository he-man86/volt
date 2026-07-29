import { PageHeader } from "../components/ui.jsx"
import { Reveal } from "../reveal.jsx"

// Static site — no backend. Contact is a mailto, not a posted form.

export const meta = () => [
  { title: "Contact — Volt" },
  { name: "description", content: "Talk to the Volt team about your PLC stack or a demo." },
]

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Contact"
        title="Talk to us."
        lead="Questions about Volt or a specific PLC setup? We'd like to hear from you."
      />
      <section className="section container" style={{ maxWidth: 560 }}>
        <Reveal>
          <div
            className="card"
            style={{ display: "grid", gap: "var(--space-4)", textAlign: "center", padding: "var(--space-8)" }}
          >
            <div className="eyebrow">Get in touch</div>
            <a href="mailto:hello@volt-ai.dev" className="h3" style={{ color: "var(--color-accent)" }}>
              hello@volt-ai.dev
            </a>
          </div>
        </Reveal>
      </section>
    </>
  )
}
