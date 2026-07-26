// Volt Connector tray mockup — the always-on connector (VoltConnector.exe) that lives in the Windows system tray.
// It's a STATUS view of the model (packages/volt-cli/src/Volt.Cli.Connector/TrayContext.cs): the detected PLC
// projects across every vendor (the connected one marked ● connected + checked), a force-Disconnect, and the menu
// (Volt Status… · Show logs · Activate in CODESYS… · Exit). Connecting is driven from the app (desktop / VS Code)
// over the control plane — the tray no longer picks a vendor or a port. Interactive: Disconnect toggles state.
import { useState } from "react"
import { useAutoplay, useInView } from "../../reveal.jsx"
import "./connector.css"

// Detected projects as the tray lists them (platform · name); one is the active connection.
const PROJECTS = [
  { vendor: "CODESYS", name: "MyMachine" },
  { vendor: "CODESYS", name: "Pro2193-94-95-96" },
  { vendor: "TwinCAT", name: "TestRig" },
]

function Bolt({ cls }) {
  return (
    <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 2 4.5 13.2c-.5.66-.03 1.6.8 1.6H11l-1.4 7.2c-.16.85.94 1.34 1.47.66L20 11.4c.5-.66.03-1.6-.8-1.6H13.5L14.6 2.9c.14-.83-.93-1.32-1.46-.66Z" fill="currentColor" />
    </svg>
  )
}
// The real tray uses Segoe MDL2 glyphs; here, matching stroke icons (Disconnect=power, Status=activity, logs=doc,
// Activate=help, Exit=×).
const ICON = {
  power: "M12 3v9M7.5 6.9a7 7 0 1 0 9 0",
  activity: "M3 12h4l2.5-7 4 14 2.5-7h5",
  doc: "M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M8 13h8M8 17h5",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.4 9.2a2.7 2.7 0 1 1 4.3 2.3c-.9.7-1.7 1-1.7 2.3M12 16.6v.9",
  close: "M6 6l12 12M18 6 6 18",
}
function Ico({ d, cls = "cx-ico" }) {
  return (
    <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export function Connector({ autoplay = false }) {
  const [ref, inView] = useInView()
  const [connected, setConnected] = useState("MyMachine") // the active connection's name, or null
  const online = connected !== null
  const play = useAutoplay([() => setConnected(null), () => setConnected("MyMachine")], autoplay && inView)

  return (
    <div ref={ref} {...play} className={"tray" + (inView ? " is-live" : "")}>
      <div className="tray-flyout" data-drag-handle>
        <div className="tray-head">
          <span className="tray-brand">
            <Bolt cls="tray-bolt" />
            Volt Connector
          </span>
          <span className="tray-ver">v0.0.1</span>
        </div>

        {/* Detected projects — status only; connecting is done from the app. */}
        <div className="tray-label">Detected projects</div>
        {PROJECTS.map((p) => {
          const isConn = p.name === connected
          return (
            <div key={p.name} className={"tray-row" + (isConn ? " is-connected" : "")}>
              <span className="tray-check">{isConn ? <Ico d="M5 12l4 4 10-10" cls="cx-ico cx-check" /> : null}</span>
              <span className="tray-row-label">
                {p.vendor} · {p.name}
              </span>
              {isConn && <span className="tray-tag">● connected</span>}
            </div>
          )
        })}

        <button className={"tray-item" + (online ? "" : " is-disabled")} onClick={() => online && setConnected(null)}>
          <Ico d={ICON.power} />
          Disconnect
        </button>

        <div className="tray-sep" />
        <button className="tray-item">
          <Ico d={ICON.activity} />
          Volt Status…
        </button>
        <button className="tray-item">
          <Ico d={ICON.doc} />
          Show logs
        </button>

        <div className="tray-sep" />
        <button className="tray-item accent">
          <Ico d={ICON.help} />
          Activate in CODESYS…
        </button>
        <button className="tray-item">
          <Ico d={ICON.close} />
          Exit
        </button>

        <span className="tray-caret" />
      </div>

      {/* system tray strip — the Volt bolt, tinted green while a project is connected (the real icon's state colour) */}
      <div className="tray-bar">
        <span className="tray-mini" />
        <span className="tray-mini" />
        <span className={"tray-mini volt" + (online ? " on" : "")}>
          <Bolt cls="tray-bolt" />
        </span>
        <span className="tray-clock">14:32</span>
      </div>
    </div>
  )
}
