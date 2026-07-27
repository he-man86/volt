// Full-bleed showcase (cursor style): the app mockup floating over an edge-to-edge public-domain painting that
// feathers into the page — with the feature copy on the left, mockup on the right.
import { Reveal } from "../reveal.jsx"
import { Arrow } from "./ui.jsx"
import "./showcase.css"

export function FeatureShowcase({ eyebrow, title, body, points = [], link, flip = false, bg = true, children }) {
  return (
    <section className={"showcase" + (flip ? " is-flip" : "") + (bg ? "" : " no-bg")}>
      {bg && <div className="showcase-bg" aria-hidden="true" />}
      {bg && <div className="showcase-scrim" aria-hidden="true" />}
      <div className="container container-wide showcase-grid">
        <Reveal className="showcase-copy">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2 className="h2" style={{ marginTop: "var(--space-2)" }}>
            {title}
          </h2>
          <p className="lead" style={{ marginTop: "var(--space-3)" }}>
            {body}
          </p>
          {points.length > 0 && (
            <ul className="feat-points">
              {points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {link && (
            <a href={link.href} className="showcase-link">
              {link.label} <Arrow />
            </a>
          )}
        </Reveal>
        <Reveal className="showcase-mockup" delayIndex={1}>
          {children}
        </Reveal>
      </div>
    </section>
  )
}
