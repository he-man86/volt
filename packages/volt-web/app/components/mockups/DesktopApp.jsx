// Reusable, reactive, interactive mockup of the Volt desktop app (packages/volt-desktop/shell.html): the IDE
// panel IS the window, with Volt's icon rail beside it. Interactions: click a rail icon to jump between the
// panel's sections (Connection ↔ Sync ↔ Diagnostics). Drag from the titlebar (data-drag-handle).
//
// There is deliberately no chat or editor pane. The app used to embed opencode's GUI as its content view; that
// integration is gone, and a mockup showing it would advertise a feature the product does not have.
import { useEffect, useRef, useState } from "react"
import { useAutoplay, useInView } from "../../reveal.jsx"
import "./desktop-app.css"

function Bolt({ cls = "vda-bolt" }) {
  return (
    <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M13 2 4.5 13.2c-.5.66-.03 1.6.8 1.6H11l-1.4 7.2c-.16.85.94 1.34 1.47.66L20 11.4c.5-.66.03-1.6-.8-1.6H13.5L14.6 2.9c.14-.83-.93-1.32-1.46-.66Z"
        fill="currentColor"
      />
    </svg>
  )
}

// Stroke icons lifted from packages/volt-desktop/shell.html — the real panel's action + rail glyphs.
const P = {
  pull: "M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4M12 3v11m0 0 4-4m-4 4-4-4",
  push: "M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4M12 15V4m0 0 4 4m-4-4-4 4",
  build:
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  refresh: "M21 12a9 9 0 1 1-2.64-6.36M21 3v5h-5",
  disconnect: "M9 7H7a5 5 0 0 0 0 10h2M15 17h2a5 5 0 0 0 0-10h-2M2 2l20 20",
  bridge: "M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8",
  alert: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01",
}
function Ico({ d, cls = "vda-ico" }) {
  return (
    <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

// A collapsible panel section (VS Code-style, mirroring shell.html's section()): the chevron + title toggle the
// body; the action buttons sit in a sibling row so they keep working while the header folds.
function Section({ id, title, acts, top, folded, onToggle, children }) {
  const open = !folded.has(id)
  return (
    <>
      <div className={"vda-sect" + (top ? " vda-sect--top" : "")}>
        <button className="vda-s-head" onClick={() => onToggle(id)} title={open ? "Collapse" : "Expand"}>
          <svg className={"vda-chev" + (open ? " open" : "")} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
          <span className="vda-s-title">{title}</span>
        </button>
        {acts && <span className="vda-s-acts">{acts}</span>}
      </div>
      {open && children}
    </>
  )
}

// The Volt IDE panel's live data, matching the real shell.html: Connection (health + one action), Sync
// (incoming/outgoing drift), Diagnostics (LSP counts). `sub` is the git status letter (A/M/D).
const INCOMING = [{ sub: "M", name: "FB_Motor" }]
const OUTGOING = [
  { sub: "M", name: "FB_Conveyor" },
  { sub: "A", name: "GVL_Global" },
]
const DIAGS = { errors: 0, warnings: 2, files: [{ name: "FB_Motor", warnings: 2 }] }

export function DesktopApp({ panel = "sync", theme = "light", autoplay = false, zoom = 1 }) {
  const [ref, inView] = useInView()
  // Which section the rail highlights. Every section is always rendered (as in the real app) — the rail
  // navigates, it never hides the panel.
  const [activeTab, setActiveTab] = useState(panel === "off" ? "sync" : panel)
  const driftN = INCOMING.length + OUTGOING.length

  // The IDE Connection demo: a real connect ⇄ disconnect cycle with in-button spinners, mirroring shell.html.
  // "connected" → click Disconnect → "disconnecting" (spinner) → "offline" (the reconnect list) → click the
  // project → "connecting" (spinner) → "connected". `live` = the two states where the bridge is up.
  const [bridge, setBridge] = useState("connected")
  const cxTimer = useRef(null)
  const live = bridge === "connected" || bridge === "disconnecting"
  const disconnect = () => {
    if (bridge !== "connected") return
    setBridge("disconnecting")
    cxTimer.current = setTimeout(() => setBridge("offline"), 900)
  }
  const reconnect = () => {
    if (bridge !== "offline") return
    setBridge("connecting")
    cxTimer.current = setTimeout(() => setBridge("connected"), 900)
  }

  // Collapsible sections (VS Code-style): a header click folds a section's body away.
  const [folded, setFolded] = useState(() => new Set())
  const toggleFold = (id) =>
    setFolded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  useEffect(() => () => clearTimeout(cxTimer.current), [])

  // Click a rail icon: light that section and make sure it is expanded.
  const showPanel = (which) => {
    setActiveTab(which)
    setFolded((prev) => {
      const next = new Set(prev)
      next.delete(which)
      return next
    })
  }

  const auto = useAutoplay(
    [
      () => showPanel("bridge"),
      () => disconnect(), // → spinner → offline (the reconnect list)
      () => reconnect(), // → spinner → connected
      () => showPanel("sync"),
      () => toggleFold("diag"), // fold a section away…
      () => showPanel("diag"), // …and jumping to it expands it again
    ],
    autoplay && inView,
  )

  return (
    <div
      ref={ref}
      {...auto}
      style={{ zoom }}
      className={"vda" + (theme === "light" ? " vda--light" : "") + (inView ? " is-live" : "")}
    >
      <div className="vda-titlebar" data-drag-handle>
        <span className="vda-brand">
          <Bolt />
          Volt
        </span>
        <span className="vda-winctl">
          <i />
          <i />
          <i />
        </span>
      </div>

      <div className="vda-body">
        {/* Volt IDE panel — the window's content. The real app stacks all three sections (shell.html); the rail
            just lights the active one. IDE Connection leads (the first thing to set up, the first thing to check
            when sync stops). */}
        <div className="vda-panel">
          <div className="vda-panel-inner">
            {/* 1. IDE Connection — an interactive connect ⇄ disconnect cycle with in-button spinners */}
            <Section id="bridge" title="IDE Connection" folded={folded} onToggle={toggleFold}>
              <div className="vda-row">
                <span className={"vda-dot-sm " + (live ? "ok" : "warn")} />
                <span className="vda-rowpath">CODESYS — MyMachine</span>
                <span className="vda-n">{live ? "connected" : "not connected"}</span>
              </div>
              {live ? (
                <div className="vda-conn-act">
                  <button
                    className="vda-connbtn"
                    title="Stops syncing. The IDE stays open — reconnect to resume."
                    onClick={disconnect}
                    disabled={bridge === "disconnecting"}
                  >
                    {bridge === "disconnecting" ? (
                      <Ico d={P.refresh} cls="vda-ico vda-ico--sm vda-spin" />
                    ) : (
                      <Ico d={P.disconnect} cls="vda-ico vda-ico--sm" />
                    )}
                    Disconnect from the IDE
                  </button>
                </div>
              ) : (
                <>
                  <div className="vda-conn-note">
                    Not syncing — pick your project below to reconnect (a different name rebinds this workspace to it):
                  </div>
                  <div className="vda-conn-act">
                    <button
                      className="vda-connbtn"
                      title="Reconnect this workspace to the IDE."
                      onClick={reconnect}
                      disabled={bridge === "connecting"}
                    >
                      {bridge === "connecting" ? (
                        <Ico d={P.refresh} cls="vda-ico vda-ico--sm vda-spin" />
                      ) : (
                        <Bolt cls="vda-bolt vda-bolt--sm" />
                      )}
                      CODESYS · MyMachine
                    </button>
                  </div>
                </>
              )}
            </Section>

            {/* 2. IDE Sync — pull/push/build/refresh + incoming/outgoing drift (offline: nothing to compare) */}
            <Section
              id="sync"
              title="IDE Sync"
              top
              folded={folded}
              onToggle={toggleFold}
              acts={
                <>
                  {live && (
                    <button className="vda-act" title="Pull · IDE → workspace">
                      <Ico d={P.pull} cls="vda-ico vda-ico--sm" />
                    </button>
                  )}
                  {live && (
                    <button className="vda-act" title="Push · workspace → IDE">
                      <Ico d={P.push} cls="vda-ico vda-ico--sm" />
                    </button>
                  )}
                  {live && (
                    <button className="vda-act" title="Build">
                      <Ico d={P.build} cls="vda-ico vda-ico--sm" />
                    </button>
                  )}
                  <button className="vda-act" title="Refresh">
                    <Ico d={P.refresh} cls="vda-ico vda-ico--sm" />
                  </button>
                </>
              }
            >
              {live ? (
                <div className="vda-scroll">
                  <div className="vda-grp">
                    Incoming · IDE → pull<span className="vda-n">{INCOMING.length}</span>
                  </div>
                  {INCOMING.map((f, i) => (
                    <div key={f.name} className="vda-row step" style={{ "--i": i + 2 }}>
                      <span className={"vda-stat " + f.sub}>{f.sub}</span>
                      <span className="vda-rowpath">{f.name}</span>
                    </div>
                  ))}
                  <div className="vda-grp">
                    Outgoing · push → IDE<span className="vda-n">{OUTGOING.length}</span>
                  </div>
                  {OUTGOING.map((f, i) => (
                    <div key={f.name} className="vda-row step" style={{ "--i": i + 3 }}>
                      <span className={"vda-stat " + f.sub}>{f.sub}</span>
                      <span className="vda-rowpath">{f.name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="vda-conn-note">
                  Not connected to the IDE, so there's nothing to compare against. Connect from IDE Connection above.
                </div>
              )}
            </Section>

            {/* 3. Diagnostics — LSP counts, independent of the bridge */}
            <Section
              id="diag"
              title="Diagnostics"
              top
              folded={folded}
              onToggle={toggleFold}
              acts={
                <button className="vda-act" title="Re-analyze">
                  <Ico d={P.refresh} cls="vda-ico vda-ico--sm" />
                </button>
              }
            >
              <div className="vda-grp">
                {DIAGS.errors} errors, {DIAGS.warnings} warnings
              </div>
              <div className="vda-scroll">
                {DIAGS.files.map((f, i) => (
                  <div key={f.name} className="vda-row step" style={{ "--i": i + 4 }}>
                    <span className="vda-rowpath">{f.name}</span>
                    <span className="vda-n">{f.warnings ? f.warnings + "⚠" : ""}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </div>

        {/* Volt icon rail — Connection, Sync, Diagnostics (top→bottom, matching shell.html) */}
        <div className="vda-rail">
          <button
            className={"vda-rail-btn" + (activeTab ==="bridge" ? " on" : "")}
            title="IDE Connection"
            onClick={() => showPanel("bridge")}
          >
            <Ico d={P.bridge} cls="vda-ico vda-ico--rail" />
            <span className={"vda-rail-status " + (live ? "ok" : "warn")} />
          </button>
          <button
            className={"vda-rail-btn" + (activeTab ==="sync" ? " on" : "")}
            title="IDE changes"
            onClick={() => showPanel("sync")}
          >
            <Bolt cls="vda-bolt vda-bolt--rail" />
            {live && <span className="vda-badge">{driftN}</span>}
          </button>
          <button
            className={"vda-rail-btn" + (activeTab ==="diag" ? " on" : "")}
            title="Diagnostics"
            onClick={() => showPanel("diag")}
          >
            <Ico d={P.alert} cls="vda-ico vda-ico--rail" />
            {DIAGS.warnings > 0 && <span className="vda-badge warn">{DIAGS.warnings}</span>}
          </button>
        </div>
      </div>
    </div>
  )
}
