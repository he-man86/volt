// Interactive VS Code mockup for the volt-vscode extension. The activity bar switches the sidebar between
// Explorer (file tree), Source Control (git changes + commit), and Volt (IDE Sync / Diagnostics / Bridge). The
// editor has drift coloring + a live IntelliSense completion; the bottom panel is a typeable agent CLI.
import { useEffect, useRef, useState } from "react"
import { useAutoplay, useInView } from "../../reveal.jsx"
import "./vscode.css"

const KW = new Set(["FUNCTION_BLOCK", "PROGRAM", "VAR", "VAR_GLOBAL", "END_VAR", "IF", "THEN", "END_IF"])
const TY = new Set(["BOOL", "REAL", "INT"])
function hl(text) {
  return text.split(/(\w+)/).map((t, i) => {
    if (KW.has(t)) return <span key={i} className="vsc-kw">{t}</span>
    if (TY.has(t)) return <span key={i} className="vsc-ty">{t}</span>
    return <span key={i}>{t}</span>
  })
}

const FILES = {
  "FB_Conveyor.fb": [
    { t: "FUNCTION_BLOCK FB_Conveyor" },
    { t: "VAR" },
    { t: "    speed   : REAL;" },
    { t: "    running : BOOL;", drift: true },
    { t: "    motor   : FB_Motor;" },
    { t: "END_VAR" },
    { t: "" },
    { t: "running := speed > 0.0;", drift: true },
    { t: "IF running THEN" },
    { t: "    motor.", complete: true },
    { t: "END_IF" },
  ],
  "PLC_PRG.prg": [
    { t: "PROGRAM PLC_PRG" },
    { t: "VAR" },
    { t: "    conveyor : FB_Conveyor;" },
    { t: "    motor    : FB_Motor;" },
    { t: "END_VAR" },
    { t: "" },
    { t: "conveyor(speed := 1.5);" },
    { t: "motor(rpm := 1200);" },
  ],
  "FB_Motor.fb": [
    { t: "FUNCTION_BLOCK FB_Motor" },
    { t: "VAR" },
    { t: "    rpm    : INT;" },
    { t: "    active : BOOL;" },
    { t: "END_VAR" },
    { t: "" },
    { t: "active := rpm > 0;" },
  ],
  "GVL_Global.gvl": [
    { t: "VAR_GLOBAL" },
    { t: "    gLineSpeed : REAL := 1.5;" },
    { t: "    gEStop     : BOOL;" },
    { t: "END_VAR" },
  ],
}

const COMPLETIONS = [
  { label: "Run", detail: "METHOD", insert: "Run();" },
  { label: "Stop", detail: "METHOD", insert: "Stop();" },
  { label: "MoveAbs", detail: "METHOD", insert: "MoveAbs(pos := 0);" },
  { label: "rpm", detail: "INT", insert: "rpm" },
]

// Explorer file tree
const EXPLORER = [
  {
    id: "root", label: "MYMACHINE", folder: true,
    children: [
      {
        id: "app", label: "Application", folder: true,
        children: [
          { id: "FB_Conveyor.fb", label: "FB_Conveyor.fb", ico: "fb", mod: "M" },
          { id: "FB_Motor.fb", label: "FB_Motor.fb", ico: "fb" },
          { id: "PLC_PRG.prg", label: "PLC_PRG.prg", ico: "prg" },
          { id: "GVL_Global.gvl", label: "GVL_Global.gvl", ico: "gvl" },
        ],
      },
    ],
  },
]

// Volt views
const VOLT_SECTIONS = [
  {
    id: "sync", title: "IDE Sync",
    rows: [
      { badge: "●", cls: "ok", label: "Connected · CODESYS" },
      { group: "Incoming · IDE → pull" },
      { badge: "i", cls: "in", label: "FB_Motor.fb", file: "FB_Motor.fb" },
      { group: "Outgoing · push → IDE" },
      { badge: "o", cls: "out", label: "FB_Conveyor.fb", file: "FB_Conveyor.fb" },
    ],
  },
  {
    id: "diag", title: "Diagnostics",
    rows: [
      { badge: "!", cls: "warn", label: "FB_Motor.fb · 2 warnings", file: "FB_Motor.fb" },
      { badge: "✓", cls: "ok", label: "No errors" },
    ],
  },
  { id: "bridge", title: "Bridge", rows: [{ badge: "●", cls: "ok", label: "CODESYS · online" }] },
]

const runCmd = (raw) => {
  const c = raw.trim()
  if (!c) return []
  if (c === "volt status") return [{ c: "", t: "  2 incoming · 1 outgoing · bridge online" }]
  if (c === "volt pull") return [{ c: "ok", t: "  ✓ merged FB_Motor.fb" }, { c: "dim", t: "  in sync with volt/ide" }]
  if (c === "volt push") return [{ c: "ok", t: "  ✓ pushed FB_Conveyor.fb → IDE" }]
  return [{ c: "dim", t: `  volt: '${c}' — try: status, pull, push` }]
}

// Activity-bar icons (stroke)
const ICON = {
  explorer: "M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9zM13 3v6h6",
}

export function VSCode({ autoplay = false }) {
  const [ref, inView] = useInView()
  const [view, setView] = useState("volt")
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [tabs, setTabs] = useState(["FB_Conveyor.fb"])
  const [active, setActive] = useState("FB_Conveyor.fb")
  const [cmpOpen, setCmpOpen] = useState(false)
  const [inserted, setInserted] = useState("")
  const [changes, setChanges] = useState([
    { name: "FB_Conveyor.fb", stat: "M" },
    { name: "GVL_Global.gvl", stat: "M" },
  ])
  const [commitMsg, setCommitMsg] = useState("")
  const [term, setTerm] = useState([
    { c: "dim", t: "~/MyMachine  volt agent" },
    { c: "head", t: "● opencode · claude-opus-4-8" },
    { c: "you", t: "› Add a running flag to FB_Conveyor" },
    { c: "act", t: "  ✎ edit FB_Conveyor.fb  +2" },
    { c: "ok", t: "  ⚙ build CODESYS  ✓ 0 errors" },
  ])
  const [draft, setDraft] = useState("")
  const termRef = useRef(null)

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [term])

  const toggle = (id) =>
    setCollapsed((p) => {
      const n = new Set(p)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  const openFile = (name) => {
    if (!FILES[name]) return
    setTabs((t) => (t.includes(name) ? t : [...t, name]))
    setActive(name)
  }
  const send = () => {
    const c = draft.trim()
    if (!c) return
    setTerm((t) => [...t, { c: "you", t: "› " + c }, ...runCmd(c)])
    setDraft("")
  }
  const commit = () => {
    if (!commitMsg.trim() || !changes.length) return
    setChanges([])
    setCommitMsg("")
  }

  const play = useAutoplay(
    [
      () => setView("explorer"),
      () => openFile("PLC_PRG.prg"),
      () => setView("scm"),
      () => openFile("GVL_Global.gvl"),
      () => setView("volt"),
      () => setActive("FB_Conveyor.fb"),
      () => setCmpOpen(true),
      () => (setInserted("Run();"), setCmpOpen(false)),
      () => (setInserted(""), setTabs(["FB_Conveyor.fb"])),
    ],
    autoplay && inView,
  )

  const renderTree = (nodes, depth) =>
    nodes.flatMap((n) => {
      const open = !collapsed.has(n.id)
      const row = (
        <div
          key={n.id}
          className={"vsc-tree-row" + (n.id === active ? " is-active" : "")}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => (n.folder ? toggle(n.id) : openFile(n.id))}
        >
          {n.folder ? <span className={"vsc-chev" + (open ? " open" : "")} /> : <span className="vsc-chev-sp" />}
          <span className={"vsc-fico " + (n.ico || "folder")} />
          <span className="vsc-side-label">{n.label}</span>
          {n.mod && <span className="vsc-tree-mod">{n.mod}</span>}
        </div>
      )
      return n.folder && open ? [row, ...renderTree(n.children, depth + 1)] : [row]
    })

  const code = FILES[active]
  const sidebarTitle = { explorer: "Explorer", scm: "Source Control", volt: "Volt" }[view]

  return (
    <div ref={ref} {...play} className={"vsc" + (inView ? " is-live" : "")}>
      <div className="vsc-title" data-drag-handle>
        <span className="vsc-title-name">{active} — MyMachine — Volt</span>
        <span className="vsc-winctl">
          <i />
          <i />
          <i />
        </span>
      </div>

      <div className="vsc-body">
        {/* activity bar */}
        <div className="vsc-activity">
          <button className={"vsc-act-btn" + (view === "explorer" ? " on" : "")} title="Explorer" onClick={() => setView("explorer")}>
            <svg className="vsc-ai" viewBox="0 0 24 24">
              <path d={ICON.explorer} />
            </svg>
          </button>
          <button className={"vsc-act-btn" + (view === "scm" ? " on" : "")} title="Source Control" onClick={() => setView("scm")}>
            <svg className="vsc-ai" viewBox="0 0 24 24">
              <circle cx="6" cy="6" r="2.4" />
              <circle cx="6" cy="18" r="2.4" />
              <circle cx="18" cy="9" r="2.4" />
              <path d="M6 8.4v7.2M8.4 7.6A6 6 0 0 1 15.6 9.2" />
            </svg>
            {changes.length > 0 && <span className="vsc-act-badge">{changes.length}</span>}
          </button>
          <button className={"vsc-act-btn volt" + (view === "volt" ? " on" : "")} title="Volt" onClick={() => setView("volt")}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M13 2 4.5 13.2c-.5.66-.03 1.6.8 1.6H11l-1.4 7.2c-.16.85.94 1.34 1.47.66L20 11.4c.5-.66.03-1.6-.8-1.6H13.5L14.6 2.9c.14-.83-.93-1.32-1.46-.66Z" fill="currentColor" />
            </svg>
          </button>
        </div>

        {/* sidebar (switches with the activity bar) */}
        <div className="vsc-side">
          <div className="vsc-side-title">{sidebarTitle}</div>

          {view === "explorer" && renderTree(EXPLORER, 0)}

          {view === "scm" && (
            <div className="vsc-scm">
              <div className="vsc-scm-row-input">
                <input
                  value={commitMsg}
                  placeholder="Message (Enter to commit)"
                  onChange={(e) => setCommitMsg(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && commit()}
                />
              </div>
              <button className="vsc-scm-commit" onClick={commit}>
                ✓ Commit
              </button>
              <div className="vsc-group">
                Changes<span className="vsc-scm-count">{changes.length}</span>
              </div>
              {changes.length === 0 ? (
                <div className="vsc-scm-empty">No changes</div>
              ) : (
                changes.map((ch) => (
                  <div key={ch.name} className="vsc-side-row clickable" onClick={() => openFile(ch.name)}>
                    <span className="vsc-fico fb" />
                    <span className="vsc-side-label">{ch.name}</span>
                    <span className="vsc-scm-stat">{ch.stat}</span>
                  </div>
                ))
              )}
            </div>
          )}

          {view === "volt" &&
            VOLT_SECTIONS.map((s) => {
              const open = !collapsed.has(s.id)
              return (
                <div key={s.id} className="vsc-sect">
                  <button className="vsc-sect-head" onClick={() => toggle(s.id)}>
                    <span className={"vsc-chev" + (open ? " open" : "")} />
                    {s.title}
                  </button>
                  {open &&
                    s.rows.map((r, i) =>
                      r.group ? (
                        <div key={i} className="vsc-group">{r.group}</div>
                      ) : (
                        <div
                          key={i}
                          className={"vsc-side-row" + (r.file ? " clickable" : "") + (r.file === active ? " is-active" : "")}
                          onClick={() => r.file && openFile(r.file)}
                        >
                          <span className={"vsc-badge " + r.cls}>{r.badge}</span>
                          <span className="vsc-side-label">{r.label}</span>
                        </div>
                      ),
                    )}
                </div>
              )
            })}
        </div>

        {/* editor + terminal */}
        <div className="vsc-center">
          <div className="vsc-tabs">
            {tabs.map((name) => (
              <span key={name} className={"vsc-tab" + (name === active ? " is-active" : "")} onClick={() => setActive(name)}>
                {name === "FB_Conveyor.fb" && <span className="vsc-dot-o" />} {name}
              </span>
            ))}
          </div>
          <div className="vsc-editor">
            <pre className="vsc-code">
              {code.map((l, i) => (
                <div key={i} className="vsc-line">
                  <span className="vsc-ln">{i + 1}</span>
                  <span className={"vsc-gutter" + (l.drift ? " drift" : "")} />
                  {l.complete ? (
                    <span className="vsc-src vsc-complete" onClick={() => !inserted && setCmpOpen((o) => !o)}>
                      {hl(l.t)}
                      {inserted ? hl(inserted) : <span className="vsc-cursor sm" />}
                      {cmpOpen && !inserted && (
                        <span className="vsc-cmp">
                          {COMPLETIONS.map((c) => (
                            <span
                              key={c.label}
                              className="vsc-cmp-item"
                              onClick={(e) => {
                                e.stopPropagation()
                                setInserted(c.insert)
                                setCmpOpen(false)
                              }}
                            >
                              <span className="vsc-cmp-ico" />
                              <span className="vsc-cmp-label">{c.label}</span>
                              <span className="vsc-cmp-detail">{c.detail}</span>
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="vsc-src">{hl(l.t)}</span>
                  )}
                </div>
              ))}
            </pre>
          </div>
          <div className="vsc-panel">
            <div className="vsc-panel-tabs">
              <span className="is-active">TERMINAL</span>
              <span>PROBLEMS</span>
              <span>OUTPUT</span>
            </div>
            <pre className="vsc-term" ref={termRef}>
              {term.map((l, i) => (
                <div key={i} className={"vsc-tl " + l.c}>{l.t}</div>
              ))}
            </pre>
            <div className="vsc-term-input">
              <span className="vsc-term-prompt">›</span>
              <input
                value={draft}
                placeholder="Run a volt command…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="vsc-status">
        <span className="vsc-st-l">
          <span>⎇ dev</span>
          <span>1↑ 1↓</span>
          <span>CODESYS ●</span>
        </span>
        <span className="vsc-st-r">
          <span>Structured Text</span>
          <span>Ln {code.length}, Col 1</span>
          <span>Volt</span>
        </span>
      </div>
    </div>
  )
}
