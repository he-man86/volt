import { PageHeader } from "../components/ui.jsx"
import { FinalCTA } from "../components/FinalCTA.jsx"
import "../components/docs.css"
import Guide from "../docs/desktop-vs-vscode.mdx"

export const meta = () => [
  { title: "Desktop app or VS Code extension? — Volt" },
  {
    name: "description",
    content:
      "Volt ships two front ends over the same core — the desktop app and the VS Code extension. Which one to use, what each costs you, and how to run both.",
  },
]

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Guide"
        title="Desktop app or VS Code extension?"
        lead="Two front ends, one core. Which one to pick, what each one costs you, and how to run both."
      />
      <section className="section container">
        <article className="docs-body" style={{ margin: "0 auto" }}>
          <Guide />
        </article>
      </section>
      <FinalCTA />
    </>
  )
}
