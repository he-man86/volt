// Lightweight, interactive CODESYS IDE mockup — the live PLC IDE Volt syncs with. Expand/collapse the device tree,
// click a POU to open it in the editor. Drag from the titlebar (data-drag-handle).
import { useState } from "react"
import { useInView } from "../../reveal.jsx"
import "./codesys.css"

const KW = new Set([
  "FUNCTION_BLOCK", "END_FUNCTION_BLOCK", "VAR", "VAR_GLOBAL", "END_VAR", "IF", "THEN", "END_IF",
  "PROGRAM", "END_PROGRAM",
])
const TY = new Set(["BOOL", "REAL", "INT", "DINT", "TIME", "WORD"])

function hl(line) {
  if (line.trimStart().startsWith("//")) return <span className="cds-cm">{line}</span>
  return line.split(/(\w+)/).map((tok, i) => {
    if (KW.has(tok))
      return (
        <span key={i} className="cds-kw">
          {tok}
        </span>
      )
    if (TY.has(tok))
      return (
        <span key={i} className="cds-ty">
          {tok}
        </span>
      )
    return <span key={i}>{tok}</span>
  })
}

// Each POU's Structured Text — selecting it in the tree opens it here.
const FILES = {
  PLC_PRG: [
    "PROGRAM PLC_PRG",
    "VAR",
    "    conveyor : FB_Conveyor;",
    "    motor    : FB_Motor;",
    "END_VAR",
    "",
    "conveyor(speed := 1.5);",
    "motor(rpm := 1200);",
  ],
  FB_Conveyor: [
    "FUNCTION_BLOCK FB_Conveyor",
    "VAR",
    "    speed   : REAL;",
    "    running : BOOL;",
    "END_VAR",
    "",
    "running := speed > 0.0;",
    "IF running THEN",
    "    motor.Run();",
    "END_IF",
  ],
  FB_Motor: [
    "FUNCTION_BLOCK FB_Motor",
    "VAR",
    "    rpm    : INT;",
    "    active : BOOL;",
    "END_VAR",
    "",
    "active := rpm > 0;",
  ],
  GVL: [
    "VAR_GLOBAL",
    "    gLineSpeed : REAL := 1.5;",
    "    gEStop     : BOOL;",
    "END_VAR",
  ],
}

// Nested device tree. Folders have children; leaves carry a `file` key into FILES.
const TREE = [
  {
    id: "dev", label: "Device (CODESYS Control)", ico: "device",
    children: [
      {
        id: "plc", label: "PLC Logic", ico: "folder",
        children: [
          {
            id: "app", label: "Application", ico: "app",
            children: [
              { id: "PLC_PRG", label: "PLC_PRG (PRG)", ico: "pou", file: "PLC_PRG" },
              { id: "FB_Conveyor", label: "FB_Conveyor (FB)", ico: "pou", file: "FB_Conveyor" },
              { id: "FB_Motor", label: "FB_Motor (FB)", ico: "pou", file: "FB_Motor" },
              { id: "GVL", label: "GVL", ico: "gvl", file: "GVL" },
            ],
          },
        ],
      },
    ],
  },
]

export function Codesys() {
  const [ref, inView] = useInView()
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [selected, setSelected] = useState("FB_Conveyor")

  const toggle = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const renderNodes = (nodes, depth) =>
    nodes.flatMap((n) => {
      const isFolder = !!n.children
      const open = !collapsed.has(n.id)
      const row = (
        <div
          key={n.id}
          className={"cds-tree-row" + (n.file === selected ? " is-active" : "")}
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() => (isFolder ? toggle(n.id) : setSelected(n.file))}
        >
          {isFolder ? <span className={"cds-chev" + (open ? " open" : "")} /> : <span className="cds-chev-sp" />}
          <span className={"cds-ico " + n.ico} />
          <span className="cds-tree-label">{n.label}</span>
        </div>
      )
      return isFolder && open ? [row, ...renderNodes(n.children, depth + 1)] : [row]
    })

  const code = FILES[selected]

  return (
    <div ref={ref} className={"cds" + (inView ? " is-live" : "")}>
      <div className="cds-title" data-drag-handle>
        <span className="cds-title-name">CODESYS — MyMachine.project</span>
        <span className="cds-winctl">
          <b>–</b>
          <b>▢</b>
          <b>✕</b>
        </span>
      </div>
      <div className="cds-toolbar">
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} className={"cds-tool" + (i === 3 || i === 6 ? " sep" : "")} />
        ))}
      </div>
      <div className="cds-body">
        <div className="cds-tree">
          <div className="cds-tree-head">Devices</div>
          {renderNodes(TREE, 0)}
        </div>
        <div className="cds-editor">
          <div className="cds-tabs">
            <span className="cds-tab">{selected}</span>
          </div>
          <pre className="cds-code">
            {code.map((line, i) => (
              <div key={i} className="cds-line">
                <span className="cds-ln">{i + 1}</span>
                <span className="cds-src">{hl(line)}</span>
              </div>
            ))}
          </pre>
        </div>
      </div>
      <div className="cds-status">
        <span className="cds-ok">● Precompile OK</span>
        <span className="cds-status-r">{selected} · {code.length} lines</span>
      </div>
    </div>
  )
}
