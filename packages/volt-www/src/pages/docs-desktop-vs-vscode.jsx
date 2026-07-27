import { renderPage } from "../shell.jsx"
import { PageHeader } from "../components/ui.jsx"
import { FinalCTA } from "../components/FinalCTA.jsx"
import "../components/docs.css"
import Guide from "../docs/desktop-vs-vscode.mdx"

renderPage(
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
  </>,
)
