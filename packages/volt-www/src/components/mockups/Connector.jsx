// Volt Connector tray mockup — the always-on connector (VoltConnector.exe) that lives in the Windows system tray.
// It's a STATUS view of the model (packages/volt-cli/src/Volt.Cli.Connector/TrayContext.cs): the detected PLC
// projects across every vendor (the connected one marked ● connected + checked), a force-Disconnect, and the menu
// (Volt Status… · Show logs · Activate in CODESYS… · Exit). Connecting is driven from the app (desktop / VS Code)
// over the control plane — the tray no longer picks a vendor or a port. Interactive: Disconnect toggles state, and
// "Volt Status…" / "Show logs" open the connector's Status + Logs dialogs (StatusWindow.cs / LogWindow.cs).
import { useState } from "react"
import { useAutoplay, useInView } from "../../reveal.jsx"
import "./connector.css"

const VERSION = "0.0.1.842"

// Detected projects as the tray lists them (platform · name); one is the active connection.
const PROJECTS = [
  { vendor: "CODESYS", name: "MyMachine" },
  { vendor: "CODESYS", name: "BottlingLine" },
  { vendor: "TwinCAT", name: "TestRig" },
]
// Status dialog — every installed Volt part vs the expected build (a ✓/⚠ so a drifted piece lights up).
const COMPONENTS = [
  { name: "volt (CLI)", ver: VERSION },
  { name: "volt-lsp-iec (LSP)", ver: VERSION },
  { name: "Connector", ver: VERSION },
  { name: "Desktop", ver: VERSION },
  { name: "VS Code extension", ver: "0.0.842" },
]
// Logs dialog — a live tail of the shared log store.
const LOGS = [
  { t: "14:32:07", src: "connector", lvl: "info", msg: "connected to MyMachine (CODESYS)" },
  { t: "14:32:07", src: "bridge.codesys", lvl: "info", msg: "/refs → 7,759 items" },
  { t: "14:32:01", src: "connector", lvl: "info", msg: "detected 3 project(s) — codesys, twincat" },
  { t: "14:31:58", src: "connector", lvl: "info", msg: "connector started; sources: codesys, twincat" },
  { t: "14:31:57", src: "updater", lvl: "info", msg: "up to date — dev channel" },
]

function Bolt({ cls }) {
  return (
    <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M13 2 4.5 13.2c-.5.66-.03 1.6.8 1.6H11l-1.4 7.2c-.16.85.94 1.34 1.47.66L20 11.4c.5-.66.03-1.6-.8-1.6H13.5L14.6 2.9c.14-.83-.93-1.32-1.46-.66Z"
        fill="currentColor"
      />
    </svg>
  )
}
// The real tray uses Segoe MDL2 glyphs; here, matching stroke icons.
const ICON = {
  power: "M12 3v9M7.5 6.9a7 7 0 1 0 9 0",
  activity: "M3 12h4l2.5-7 4 14 2.5-7h5",
  doc: "M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M8 13h8M8 17h5",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.4 9.2a2.7 2.7 0 1 1 4.3 2.3c-.9.7-1.7 1-1.7 2.3M12 16.6v.9",
  close: "M6 6l12 12M18 6 6 18",
  check: "M5 12l4 4 10-10",
}
function Ico({ d, cls = "cx-ico" }) {
  return (
    <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

function StatusDialog({ onClose, onLogs }) {
  const [channel, setChannel] = useState("dev")
  return (
    <div className="cx-dialog cx-dialog--status" onClick={(e) => e.stopPropagation()}>
      <div className="cx-dlg-head">
        <span>Volt — Status</span>
        <button className="cx-close" onClick={onClose} aria-label="Close">
          <Ico d={ICON.close} cls="cx-ico" />
        </button>
      </div>
      <div className="cx-dlg-body">
        <div className="cx-status-head">
          <span className="cx-status-title">Volt Connector</span>
          <span className="cx-mono cx-muted">v{VERSION}</span>
        </div>
        <div className="cx-status-line">
          <span className="cx-tag-ok">✓ Up to date</span>
          <button className="cx-btn">Check now</button>
        </div>

        <div className="cx-group">
          <div className="cx-group-title">Update channel</div>
          {[
            ["stable", "Stable — released builds"],
            ["dev", "Dev — latest fixes, pre-release"],
          ].map(([id, label]) => (
            <button key={id} className="cx-radio-row" onClick={() => setChannel(id)}>
              <span className={"cx-radio" + (channel === id ? " on" : "")} />
              {label}
            </button>
          ))}
        </div>

        <div className="cx-group-title">Installed components</div>
        <div className="cx-comp">
          {COMPONENTS.map((c) => (
            <div key={c.name} className="cx-comp-row">
              <span className="cx-comp-name">{c.name}</span>
              <span className="cx-mono cx-muted">{c.ver}</span>
              <span className="cx-comp-sync">
                <Ico d={ICON.check} cls="cx-ico cx-check" /> in sync
              </span>
            </div>
          ))}
        </div>

        <div className="cx-dlg-foot">
          <button className="cx-btn" onClick={onLogs}>
            Open logs
          </button>
        </div>
      </div>
    </div>
  )
}

function LogsDialog({ onClose }) {
  return (
    <div className="cx-dialog cx-dialog--logs" onClick={(e) => e.stopPropagation()}>
      <div className="cx-dlg-head">
        <span>Volt — Logs</span>
        <button className="cx-close" onClick={onClose} aria-label="Close">
          <Ico d={ICON.close} cls="cx-ico" />
        </button>
      </div>
      <div className="cx-log-tools">
        <span className="cx-select">all sources ▾</span>
        <span className="cx-select">all levels ▾</span>
        <span className="cx-filter">filter…</span>
        <button className="cx-btn cx-btn--right">Open folder</button>
      </div>
      <div className="cx-log-list">
        <div className="cx-log-row cx-log-head">
          <span>Time</span>
          <span>Source</span>
          <span>Level</span>
          <span>Message</span>
        </div>
        {LOGS.map((l, i) => (
          <div key={i} className="cx-log-row">
            <span className="cx-muted">{l.t}</span>
            <span>{l.src}</span>
            <span className={"cx-lvl cx-lvl--" + l.lvl}>{l.lvl}</span>
            <span>{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Connector({ autoplay = false }) {
  const [ref, inView] = useInView()
  const [connected, setConnected] = useState("MyMachine") // the active connection's name, or null
  const [dialog, setDialog] = useState(null) // null | "status" | "logs"
  const online = connected !== null
  const play = useAutoplay(
    [
      () => setConnected(null),
      () => setConnected("MyMachine"),
      () => setDialog("status"),
      () => setDialog(null),
      () => setDialog("logs"),
      () => setDialog(null),
    ],
    autoplay && inView,
  )

  return (
    <div ref={ref} {...play} className={"tray" + (inView ? " is-live" : "")}>
      <div className="tray-flyout" data-drag-handle>
        <div className="tray-head">
          <span className="tray-brand">
            <Bolt cls="tray-bolt" />
            Volt Connector
          </span>
          <span className="tray-ver">v{VERSION}</span>
        </div>

        {/* Detected projects — status only; connecting is done from the app. */}
        <div className="tray-label">Detected projects</div>
        {PROJECTS.map((p) => {
          const isConn = p.name === connected
          return (
            <div key={p.name} className={"tray-row" + (isConn ? " is-connected" : "")}>
              <span className="tray-check">{isConn ? <Ico d={ICON.check} cls="cx-ico cx-check" /> : null}</span>
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
        <button className="tray-item" onClick={() => setDialog("status")}>
          <Ico d={ICON.activity} />
          Volt Status…
        </button>
        <button className="tray-item" onClick={() => setDialog("logs")}>
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

      {dialog !== null && (
        <div className="tray-overlay" onClick={() => setDialog(null)}>
          {dialog === "status" ? (
            <StatusDialog onClose={() => setDialog(null)} onLogs={() => setDialog("logs")} />
          ) : (
            <LogsDialog onClose={() => setDialog(null)} />
          )}
        </div>
      )}
    </div>
  )
}
