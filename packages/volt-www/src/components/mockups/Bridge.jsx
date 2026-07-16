// Volt Bridge tray mockup — the always-on connector (VoltConnector.exe) that lives in the system tray, manages the
// bridge, and lets you pick which live IDE it connects to. Interactive: select the IDE, toggle auto-update.
import { useState } from "react"
import { useInView } from "../../reveal.jsx"
import "./bridge.css"

const IDES = [
  { id: "codesys", name: "CODESYS", note: "CODESYS-based tooling", port: 8556 },
  { id: "twincat", name: "TwinCAT (Beckhoff)", note: "TE1000 / XAE", port: 8555 },
]
const PLANNED = ["Siemens TIA Portal", "Rockwell Studio 5000"]

function Bolt({ cls }) {
  return (
    <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 2 4.5 13.2c-.5.66-.03 1.6.8 1.6H11l-1.4 7.2c-.16.85.94 1.34 1.47.66L20 11.4c.5-.66.03-1.6-.8-1.6H13.5L14.6 2.9c.14-.83-.93-1.32-1.46-.66Z" fill="currentColor" />
    </svg>
  )
}

export function Bridge() {
  const [ref, inView] = useInView()
  const [ide, setIde] = useState("codesys")
  const [auto, setAuto] = useState(true)
  const active = IDES.find((i) => i.id === ide)

  return (
    <div ref={ref} className={"tray" + (inView ? " is-live" : "")}>
      <div className="tray-flyout" data-drag-handle>
        <div className="tray-head">
          <span className="tray-brand">
            <Bolt cls="tray-bolt" />
            Volt Bridge
          </span>
          <span className="tray-online">
            <span className="tray-dot" />
            {active.name} · online
          </span>
        </div>

        <div className="tray-label">Connected IDE</div>
        {IDES.map((i) => (
          <button key={i.id} className={"tray-ide" + (i.id === ide ? " is-active" : "")} onClick={() => setIde(i.id)}>
            <span className={"tray-radio" + (i.id === ide ? " on" : "")} />
            <span className="tray-ide-main">
              <span className="tray-ide-name">{i.name}</span>
              <span className="tray-ide-note">{i.note}</span>
            </span>
            <span className="tray-port">:{i.port}</span>
            {i.id === ide && <span className="tray-dot" />}
          </button>
        ))}

        <div className="tray-label">In consideration</div>
        {PLANNED.map((p) => (
          <div key={p} className="tray-ide is-planned">
            <span className="tray-radio" />
            <span className="tray-ide-main">
              <span className="tray-ide-name">{p}</span>
            </span>
            <span className="tray-soon">Planned</span>
          </div>
        ))}

        <div className="tray-foot">
          <button className="tray-toggle-row" onClick={() => setAuto((a) => !a)}>
            <span className="tray-ide-name">Auto-update</span>
            <span className={"tray-switch" + (auto ? " on" : "")}>
              <span className="tray-knob" />
            </span>
          </button>
          <div className="tray-actions">
            <span className="tray-ver">v1.2.0</span>
            <button className="tray-btn">Open Volt</button>
            <button className="tray-btn">Quit</button>
          </div>
        </div>

        <span className="tray-caret" />
      </div>

      {/* system tray strip */}
      <div className="tray-bar">
        <span className="tray-mini" />
        <span className="tray-mini" />
        <span className="tray-mini volt">
          <Bolt cls="tray-bolt" />
        </span>
        <span className="tray-clock">14:32</span>
      </div>
    </div>
  )
}
