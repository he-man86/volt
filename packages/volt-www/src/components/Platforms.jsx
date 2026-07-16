// Supported-platforms band (cursor's "trusted by" pattern): a muted centered heading + a single row of subdued,
// uniform wordmarks. Wordmarks, not vendor logos.
import { PLATFORMS } from "../content.js"
import { Reveal } from "../reveal.jsx"

export function Platforms() {
  return (
    <section className="platforms">
      <Reveal className="container container-wide">
        <p className="platforms-label">Full support for the PLC platforms you already run</p>
        <div className="platforms-row">
          {PLATFORMS.map((name) => (
            <span key={name} className="platforms-mark">
              {name}
            </span>
          ))}
        </div>
      </Reveal>
    </section>
  )
}
