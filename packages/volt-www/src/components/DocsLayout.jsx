// Prose helpers embedded in the two guide pages' MDX: a live-mockup Figure and a numbered Step.
// (The former "On this page" outline/ToC sidebar was removed — the guides render as normal pages now.)
import "./docs.css"

// Mockup slot inside the prose: the live product widget + a caption saying what to look at.
export function Figure({ caption, wide = false, children }) {
  return (
    <figure className={"docs-figure" + (wide ? " is-wide" : "")}>
      <div className="docs-figure-frame">{children}</div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}

// A numbered step marker used as a lead-in to each `##` section's instructions.
export function Step({ n, children }) {
  return (
    <p className="docs-step">
      <span className="docs-step-n">{n}</span>
      {/* one wrapper, or inline `code`/`strong` become flex items and get spaced apart */}
      <span>{children}</span>
    </p>
  )
}
