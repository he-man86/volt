// Reusable, reactive, interactive mockup of the Volt desktop app (packages/volt-desktop/shell.html): the Electron
// shell wrapping opencode's chat, plus Volt's icon rail + IDE panel. Interactions: click a rail icon to
// open/close/switch the IDE panel (Connection ↔ Sync ↔ Diagnostics). Drag from the titlebar (data-drag-handle).
import { useEffect, useRef, useState } from "react"
import { useAutoplay, useInView } from "../../reveal.jsx"
import "./desktop-app.css"

// Volt's gateway proxies these providers (see the privacy policy): Anthropic (Claude) + DeepSeek.
const MODELS = [
  { group: "Claude", items: ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5"] },
  { group: "DeepSeek", items: ["deepseek-v3", "deepseek-r1"] },
]

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
  build: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
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

const DIFF = [
  { n: 3, sign: " ", text: "VAR" },
  { n: 4, sign: "+", text: "    running : BOOL;" },
  { n: 5, sign: " ", text: "END_VAR" },
  { n: 6, sign: " ", text: "" },
  { n: 7, sign: "+", text: "running := speed > 0.0;" },
]
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
  const [panelState, setPanelState] = useState(panel)
  const [selected, setSelected] = useState("FB_Conveyor")
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

  // Chat: type + send appends your message; a short typing indicator resolves to a reply. Auto-scrolls.
  const [draft, setDraft] = useState("")
  const [msgs, setMsgs] = useState([])
  const [typing, setTyping] = useState(false)
  const [model, setModel] = useState("claude-opus-4-8")
  const [modelOpen, setModelOpen] = useState(false)
  const chatRef = useRef(null)
  const timer = useRef(null)

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [msgs, typing])
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => () => clearTimeout(cxTimer.current), [])

  const send = () => {
    const text = draft.trim()
    if (!text) return
    setMsgs((m) => [...m, { role: "user", text }])
    setDraft("")
    setTyping(true)
    timer.current = setTimeout(() => {
      setTyping(false)
      setMsgs((m) => [...m, { role: "agent", text: "On it — let me take a look at that in your project." }])
    }, 1100)
  }

  // click a rail icon: open that panel (and expand its section), or close it if already showing
  const showPanel = (which) => {
    setPanelState((p) => (p === which ? "off" : which))
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
      () => setModelOpen(true),
      () => (setModel("claude-sonnet-5"), setModelOpen(false)),
      () => showPanel("sync"),
      () => setSelected("FB_Conveyor"),
      () => showPanel("diag"),
      () => setModelOpen(true),
      () => (setModel("claude-opus-4-8"), setModelOpen(false)),
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
        {/* opencode: the chat */}
        <div className="vda-main">
          <div className="vda-main-head">
            <span className="vda-tab">Conveyor logic</span>
            <span className="vda-path">{selected}.st</span>
          </div>
          <div className="vda-chat" ref={chatRef}>
            <div className="vda-msg step vda-msg--user" style={{ "--i": 0 }}>
              <div className="vda-bubble">Add a `running` flag to FB_Conveyor, set it when speed &gt; 0, then build.</div>
            </div>

            <div className="vda-turn">
              <span className="vda-avatar step" style={{ "--i": 1 }}>
                <Bolt cls="vda-bolt vda-bolt--sm" />
              </span>
              <div className="vda-turn-body">
                <div className="vda-say step" style={{ "--i": 1 }}>
                  I'll add the variable and the assignment, then run a build to check it.
                </div>

                <div className="vda-tool step" style={{ "--i": 2 }}>
                  <div className="vda-tool-head">
                    <span className="vda-tool-ico edit" />
                    <span className="vda-tool-name">Edit</span>
                    <span className="vda-tool-file">FB_Conveyor.st</span>
                    <span className="vda-tool-meta">+2</span>
                  </div>
                  <pre className="vda-code">
                    {DIFF.map((l, j) => (
                      <div key={j} className={"vda-cl " + (l.sign === "+" ? "add" : l.sign === "-" ? "del" : "")}>
                        <span className="vda-ln">{l.n}</span>
                        <span className="vda-sign">{l.sign}</span>
                        <span className="vda-cx">{l.text}</span>
                      </div>
                    ))}
                  </pre>
                </div>

                <div className="vda-tool vda-tool--flat step" style={{ "--i": 3 }}>
                  <div className="vda-tool-head">
                    <span className="vda-tool-ico build" />
                    <span className="vda-tool-name">Build</span>
                    <span className="vda-tool-file">CODESYS</span>
                    <span className="vda-tool-ok">✓ 0 errors · 2 warnings</span>
                  </div>
                </div>

                <div className="vda-say step" style={{ "--i": 4 }}>
                  Done — <span className="vda-code-inline">running</span> is set whenever speed exceeds 0. Build passes.
                </div>
              </div>
            </div>

            {/* messages you type */}
            {msgs.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="vda-msg vda-msg--user">
                  <div className="vda-bubble">{m.text}</div>
                </div>
              ) : (
                <div key={i} className="vda-turn">
                  <span className="vda-avatar">
                    <Bolt cls="vda-bolt vda-bolt--sm" />
                  </span>
                  <div className="vda-turn-body">
                    <div className="vda-say">{m.text}</div>
                  </div>
                </div>
              ),
            )}
            {typing && (
              <div className="vda-turn">
                <span className="vda-avatar">
                  <Bolt cls="vda-bolt vda-bolt--sm" />
                </span>
                <div className="vda-typing">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            )}
          </div>

          <div className="vda-inputbar">
            <div className="vda-input">
              <Bolt cls="vda-bolt vda-bolt--sm" />
              <input
                className="vda-field"
                value={draft}
                placeholder="Ask about your PLC project…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
              <span className="vda-chip">Build</span>
              <div className="vda-model">
                <button className="vda-chip model" onClick={() => setModelOpen((o) => !o)}>
                  {model}
                  <span className={"vda-chevdown" + (modelOpen ? " open" : "")} />
                </button>
                {modelOpen && (
                  <div className="vda-model-menu">
                    {MODELS.map((g) => (
                      <div key={g.group} className="vda-model-group">
                        <div className="vda-model-glabel">{g.group}</div>
                        {g.items.map((it) => (
                          <button
                            key={it}
                            className={"vda-model-item" + (it === model ? " is-active" : "")}
                            onClick={() => {
                              setModel(it)
                              setModelOpen(false)
                            }}
                          >
                            {it}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button className="vda-send" onClick={send} title="Send" aria-label="Send">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 12h13m0 0-5-5m5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Volt IDE panel — the real app stacks all three views (shell.html); the rail just lights the active one.
            IDE Connection leads (the first thing to set up, the first thing to check when sync stops). */}
        {panelState !== "off" && (
          <div className="vda-panel">
            {/* 1. IDE Connection — an interactive connect ⇄ disconnect cycle with in-button spinners */}
            <Section id="bridge" title="IDE Connection" folded={folded} onToggle={toggleFold}>
              <div className="vda-row">
                <span className={"vda-dot-sm " + (live ? "ok" : "warn")} />
                <span className="vda-rowpath">CODESYS — MyMachine</span>
                <span className="vda-n">{live ? "connected" : "not connected"}</span>
              </div>
              {live ? (
                <div className="vda-conn-act">
                  <button className="vda-connbtn" title="Stops syncing. The IDE stays open — reconnect to resume." onClick={disconnect} disabled={bridge === "disconnecting"}>
                    {bridge === "disconnecting" ? <Ico d={P.refresh} cls="vda-ico vda-ico--sm vda-spin" /> : <Ico d={P.disconnect} cls="vda-ico vda-ico--sm" />}
                    Disconnect from the IDE
                  </button>
                </div>
              ) : (
                <>
                  <div className="vda-conn-note">Not syncing — pick your project below to reconnect (a different name rebinds this workspace to it):</div>
                  <div className="vda-conn-act">
                    <button className="vda-connbtn" title="Reconnect this workspace to the IDE." onClick={reconnect} disabled={bridge === "connecting"}>
                      {bridge === "connecting" ? <Ico d={P.refresh} cls="vda-ico vda-ico--sm vda-spin" /> : <Bolt cls="vda-bolt vda-bolt--sm" />}
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
                  {live && <button className="vda-act" title="Pull · IDE → workspace"><Ico d={P.pull} cls="vda-ico vda-ico--sm" /></button>}
                  {live && <button className="vda-act" title="Push · workspace → IDE"><Ico d={P.push} cls="vda-ico vda-ico--sm" /></button>}
                  {live && <button className="vda-act" title="Build"><Ico d={P.build} cls="vda-ico vda-ico--sm" /></button>}
                  <button className="vda-act" title="Refresh"><Ico d={P.refresh} cls="vda-ico vda-ico--sm" /></button>
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
                <div className="vda-conn-note">Not connected to the IDE, so there's nothing to compare against. Connect from IDE Connection above.</div>
              )}
            </Section>

            {/* 3. Diagnostics — LSP counts, independent of the bridge */}
            <Section
              id="diag"
              title="Diagnostics"
              top
              folded={folded}
              onToggle={toggleFold}
              acts={<button className="vda-act" title="Re-analyze"><Ico d={P.refresh} cls="vda-ico vda-ico--sm" /></button>}
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
        )}

        {/* Volt icon rail — Connection, Sync, Diagnostics (top→bottom, matching shell.html) */}
        <div className="vda-rail">
          <button className={"vda-rail-btn" + (panelState === "bridge" ? " on" : "")} title="IDE Connection" onClick={() => showPanel("bridge")}>
            <Ico d={P.bridge} cls="vda-ico vda-ico--rail" />
            <span className={"vda-rail-status " + (live ? "ok" : "warn")} />
          </button>
          <button className={"vda-rail-btn" + (panelState === "sync" ? " on" : "")} title="IDE changes" onClick={() => showPanel("sync")}>
            <Bolt cls="vda-bolt vda-bolt--rail" />
            {live && <span className="vda-badge">{driftN}</span>}
          </button>
          <button className={"vda-rail-btn" + (panelState === "diag" ? " on" : "")} title="Diagnostics" onClick={() => showPanel("diag")}>
            <Ico d={P.alert} cls="vda-ico vda-ico--rail" />
            {DIAGS.warnings > 0 && <span className="vda-badge warn">{DIAGS.warnings}</span>}
          </button>
        </div>
      </div>
    </div>
  )
}
