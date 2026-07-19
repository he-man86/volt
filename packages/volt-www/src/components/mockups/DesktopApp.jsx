// Reusable, reactive, interactive mockup of the Volt desktop app (packages/volt-desktop/shell.html): the Electron
// shell wrapping opencode's chat, plus Volt's file explorer + icon rail + IDE panel. Interactions: expand/collapse
// the explorer, click a file to open it (updates the editor header), click a rail icon to open/close/switch the
// IDE panel (Sync ↔ Diagnostics). Drag from the titlebar (data-drag-handle).
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

// File explorer tree (nested): folders expand/collapse, leaves (file) select into the editor.
const TREE = [
  {
    id: "root", label: "MyMachine", folder: true,
    children: [
      {
        id: "app", label: "Application", folder: true,
        children: [
          { id: "PLC_PRG", label: "PLC_PRG", ext: "PRG", ico: "pou" },
          { id: "FB_Conveyor", label: "FB_Conveyor", ext: "FB", ico: "pou", mod: "M" },
          { id: "FB_Motor", label: "FB_Motor", ext: "FB", ico: "pou" },
          { id: "GVL_Global", label: "GVL_Global", ext: "GVL", ico: "var" },
        ],
      },
      { id: "device", label: "Device", folder: true, children: [{ id: "ctrl", label: "CODESYS Control", ico: "pou" }] },
    ],
  },
]
const DIFF = [
  { n: 3, sign: " ", text: "VAR" },
  { n: 4, sign: "+", text: "    running : BOOL;" },
  { n: 5, sign: " ", text: "END_VAR" },
  { n: 6, sign: " ", text: "" },
  { n: 7, sign: "+", text: "running := speed > 0.0;" },
]
const DEFAULT_DRIFT = [
  { sub: "M", name: "FB_Conveyor" },
  { sub: "M", name: "PLC_PRG" },
  { sub: "A", name: "GVL_Global" },
]

export function DesktopApp({ panel = "sync", theme = "light", explorer = true, autoplay = false, drift = DEFAULT_DRIFT, diagnostics }) {
  const [ref, inView] = useInView()
  const [panelState, setPanelState] = useState(panel)
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [selected, setSelected] = useState("FB_Conveyor")
  const diags = diagnostics ?? { errors: 0, warnings: 2, files: [{ name: "FB_Motor", warnings: 2 }] }

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

  const toggle = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  // click a rail icon: open that panel, or close it if already showing
  const showPanel = (which) => setPanelState((p) => (p === which ? "off" : which))

  const auto = useAutoplay(
    [
      () => showPanel("diagnostics"),
      () => setSelected("PLC_PRG"),
      () => setModelOpen(true),
      () => (setModel("claude-sonnet-5"), setModelOpen(false)),
      () => showPanel("sync"),
      () => setSelected("FB_Conveyor"),
      () => setModelOpen(true),
      () => (setModel("claude-opus-4-8"), setModelOpen(false)),
    ],
    autoplay && inView,
  )

  const renderNodes = (nodes, depth) =>
    nodes.flatMap((n) => {
      const open = !collapsed.has(n.id)
      const row = (
        <div
          key={n.id}
          className={"vda-exp-row" + (!n.folder && n.id === selected ? " is-active" : "")}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => (n.folder ? toggle(n.id) : setSelected(n.id))}
        >
          {n.folder ? <span className={"vda-chev" + (open ? " open" : "")} /> : <span className="vda-chev-sp" />}
          <span className={"vda-exp-ico " + (n.ico || "")} />
          <span className="vda-exp-name">{n.label}</span>
          {n.ext && <span className="vda-exp-ext">{n.ext}</span>}
          {n.mod && <span className="vda-exp-mod">{n.mod}</span>}
        </div>
      )
      return n.folder && open ? [row, ...renderNodes(n.children, depth + 1)] : [row]
    })

  return (
    <div
      ref={ref}
      {...auto}
      className={"vda" + (theme === "light" ? " vda--light" : "") + (explorer ? " vda--exp" : "") + (inView ? " is-live" : "")}
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

        {/* File explorer (optional) */}
        {explorer && (
          <div className="vda-explorer">
            <div className="vda-exp-head">Explorer</div>
            {renderNodes(TREE, 0)}
          </div>
        )}

        {/* Volt IDE panel */}
        {panelState !== "off" && (
          <div className="vda-panel">
            {panelState === "sync" ? (
              <>
                <div className="vda-sect">
                  <span className="vda-s-title">IDE Sync</span>
                  <span className="vda-s-acts">
                    <i title="Pull" /> <i title="Push" /> <i title="Build" />
                  </span>
                </div>
                <div className="vda-grp">
                  Incoming · IDE → pull<span className="vda-n">{drift.length}</span>
                </div>
                {drift.map((f, i) => (
                  <div key={f.name} className="vda-row step" style={{ "--i": i + 2 }}>
                    <span className={"vda-stat " + f.sub}>{f.sub}</span>
                    <span className="vda-rowpath">{f.name}</span>
                  </div>
                ))}
                <div className="vda-sect vda-sect--top">
                  <span className="vda-s-title">Bridge</span>
                </div>
                <div className="vda-row">
                  <span className="vda-dot-sm ok" />
                  <span className="vda-rowpath">CODESYS · online</span>
                </div>
              </>
            ) : (
              <>
                <div className="vda-sect">
                  <span className="vda-s-title">Diagnostics</span>
                </div>
                <div className="vda-grp">
                  {diags.errors} errors, {diags.warnings} warnings
                </div>
                {diags.files.map((f, i) => (
                  <div key={f.name} className="vda-row step" style={{ "--i": i + 2 }}>
                    <span className="vda-rowpath">{f.name}</span>
                    <span className="vda-n">{f.warnings ? f.warnings + "⚠" : ""}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* Volt icon rail */}
        <div className="vda-rail">
          <button className={"vda-rail-btn" + (panelState === "sync" ? " on" : "")} title="IDE changes" onClick={() => showPanel("sync")}>
            <Bolt cls="vda-bolt vda-bolt--rail" />
            <span className="vda-badge">{drift.length}</span>
          </button>
          <button
            className={"vda-rail-btn" + (panelState === "diagnostics" ? " on" : "")}
            title="Diagnostics"
            onClick={() => showPanel("diagnostics")}
          >
            <svg className="vda-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
            {diags.warnings > 0 && <span className="vda-badge warn">{diags.warnings}</span>}
          </button>
          <span className="vda-rail-dot ok" title="Bridge online" />
        </div>
      </div>
    </div>
  )
}
