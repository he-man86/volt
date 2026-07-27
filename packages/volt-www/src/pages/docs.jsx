import { renderPage } from "../shell.jsx"
import { PageHeader } from "../components/ui.jsx"
import { FinalCTA } from "../components/FinalCTA.jsx"
import "../components/docs.css"
import Guide from "../docs/getting-started.mdx"

renderPage(
  <>
    <PageHeader
      eyebrow="Guide"
      title="Getting started with Volt"
      lead="Install, connect to your live CODESYS or TwinCAT project, pull it into git, work with the agent, push back."
    />
    <section className="section container">
      <article className="docs-body" style={{ margin: "0 auto" }}>
        <Guide />
      </article>
    </section>
    <FinalCTA />
  </>,
)
