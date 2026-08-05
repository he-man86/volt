import { PageHeader } from "../components/ui.jsx"
import { FinalCTA } from "../components/FinalCTA.jsx"
import "../components/docs.css"
import Guide from "../docs/agents.mdx"

export const meta = () => [
  { title: "Using Volt with your AI agent — Volt" },
  {
    name: "description",
    content:
      "How to use Volt from Claude Code, VS Code, Cursor, Windsurf and Claude Desktop. Volt ships no agent — every host reaches it through the volt CLI, plus an optional extension or plugin for language intelligence.",
  },
]

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Guide"
        title="Using Volt with your AI agent"
        lead="Volt ships no agent and installs itself into none. Here is what each host needs — usually nothing."
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
