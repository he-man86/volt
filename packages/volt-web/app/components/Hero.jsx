import { Button, Arrow } from "./ui.jsx"
import { DesktopApp } from "./mockups/DesktopApp.jsx"
import { Codesys } from "./mockups/Codesys.jsx"
import { Draggable } from "./mockups/Draggable.jsx"
import { Reveal } from "../reveal.jsx"
import "./hero.css"

export function Hero() {
  return (
    <section className="hero">
      <div className="container container-wide" style={{ paddingTop: "var(--space-10)", position: "relative" }}>
        <Reveal>
          <h1 className="display" style={{ maxWidth: 720 }}>
            The AI coding agent for
            <br />
            industrial automation.
          </h1>
        </Reveal>
        <Reveal delayIndex={1}>
          <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)", flexWrap: "wrap" }}>
            <Button kind="download" variant="primary" size="lg">
              Download for Windows
            </Button>
            <Button href="/docs" variant="secondary" size="lg">
              Read the docs <Arrow />
            </Button>
          </div>
        </Reveal>
        <Reveal className="hero-stage" delayIndex={3}>
          <Draggable className="hero-main">
            <DesktopApp panel="sync" theme="light" />
          </Draggable>
          <Draggable className="hero-cds" style={{ position: "absolute", right: "0", bottom: "-28px" }}>
            <Codesys />
          </Draggable>
          <span className="hero-drag-hint">Drag the windows ↔</span>
        </Reveal>
      </div>
      <div className="hero-art" aria-hidden="true" />
      <div className="hero-glow" aria-hidden="true" />
    </section>
  )
}
