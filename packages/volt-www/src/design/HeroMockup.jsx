// Interactive hero: the CODESYS IDE and the Volt app shown as draggable windows.
// Volt mirrors the CODESYS project — drag either "Fenster" around to explore.

const SCENARIOS = {
  Understand: {
    prompt: "Explain this project",
    title: "Project summary",
    body: [
      { h: "Architecture", t: "3 programs orchestrated by Main, 2 reusable function blocks." },
      { h: "Dependencies", t: "Conveyor depends on Safety.OK and FB_Motor." },
      { h: "Risks", t: "MotorSpeed written from 2 POUs without interlock." },
    ],
    tag: "8 POUs analyzed",
  },
  Debug: {
    prompt: "Why won't Conveyor 2 start?",
    title: "Root cause located",
    body: [
      { h: "Enable chain", t: "Conveyor2.Ready is gated by Guard.Closed (Safety, line 42)." },
      { h: "Interlock", t: "Guard.Closed is FALSE — start guard sensor is open." },
      { h: "Suggested fix", t: "Check Safety → Guard wiring or GlobalVars override." },
    ],
    tag: "Traced across 4 POUs",
  },
  Document: {
    prompt: "Generate documentation",
    title: "Documentation drafted",
    body: [
      { h: "Architecture docs", t: "System overview + data-flow from project structure." },
      { h: "Function block docs", t: "FB_Motor and FB_Conveyor documented with I/O tables." },
      { h: "Dependency map", t: "Exported as Markdown, ready to commit." },
    ],
    tag: "4 docs generated",
  },
  Test: {
    prompt: "Create tests for FB_Motor",
    title: "Tests running",
    body: [
      { h: "bun test", t: "3 unit tests generated through the mirrored repo." },
      { h: "Validation", t: "Ramp, fault latch, enable-gate cases covered." },
      { h: "Result", t: "✓ 3 passed in 41ms" },
    ],
    tag: "Bun · 3 passed",
  },
  Refactor: {
    prompt: "What if I change MotorSpeed?",
    title: "Impact analysis",
    body: [
      { h: "3 readers", t: "Conveyor, FB_Motor and Alarms reference it directly." },
      { h: "1 writer", t: "Main sets it during recipe load — safe to retype." },
      { h: "Recommendation", t: "Update Alarms.Overspeed threshold to match." },
    ],
    tag: "Whole-project scan",
  },
};

// ---- Draggable window wrapper ----
function useDrag(initial) {
  const [pos, setPos] = React.useState(initial);
  const drag = React.useRef(null);
  React.useEffect(() => {
    const move = (e) => {
      if (!drag.current) return;
      setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
    };
    const up = () => { drag.current = null; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);
  const onDown = (e) => {
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    document.body.style.userSelect = "none";
  };
  return [pos, onDown];
}

function Win({ pos, onDown, z, onFocus, width, children, accent }) {
  return (
    <div onMouseDown={onFocus} style={{
      position: "absolute", left: pos.x, top: pos.y, width, zIndex: z,
      background: "#fff", border: "1px solid var(--color-border)",
      borderRadius: 12, boxShadow: z > 1 ? "0 18px 48px rgba(13,13,13,0.18)" : "var(--shadow-lg)",
      overflow: "hidden",
    }}>{children}</div>
  );
}

// ---- CODESYS IDE window ----
const POUS = [
  { n: "Machine", d: 0, f: 1 }, { n: "Main", d: 1, p: 1 }, { n: "Conveyor", d: 1, p: 1, active: 1 },
  { n: "Safety", d: 1, p: 1 }, { n: "Alarms", d: 1, p: 1 },
  { n: "FB_Motor", d: 1, b: 1 }, { n: "FB_Conveyor", d: 1, b: 1 }, { n: "GlobalVars", d: 1, g: 1 },
];
const ST = [
  ["1", [["k", "PROGRAM"], ["t", " Conveyor"]]],
  ["2", [["c", "(* Main transport line *)"]]],
  ["3", [["k", "VAR"]]],
  ["4", [["v", "    MotorSpeed"], ["p", " : "], ["y", "REAL"], ["p", " := "], ["n", "1500.0"], ["p", ";"]]],
  ["5", [["v", "    Enable"], ["p", " : "], ["y", "BOOL"], ["p", ";"]]],
  ["6", [["k", "END_VAR"]]],
  ["7", [[]]],
  ["8", [["v", "FB_Motor"], ["p", "(Speed := MotorSpeed,"]]],
  ["9", [["p", "         Run := Enable "], ["k", "AND"], ["p", " Safety.OK);"]]],
];
const stTint = { k: "#C2410C", y: "#B45309", n: "#16A344", c: "#9b968c", v: "#0D0D0D", p: "#525252", t: "#525252" };

function CodesysWindow() {
  return (
    <div>
      {/* title bar */}
      <div className="dragbar" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#2b2b2b", cursor: "grab" }}>
        <Icon d={ICONS.cpu} size={14} stroke="#d4d4d4" />
        <span style={{ fontSize: 12.5, color: "#e5e5e5", fontWeight: 500 }}>CODESYS — Machine.project</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 14, color: "#8a8a8a" }}>
          <span style={{ fontSize: 13 }}>—</span><span style={{ fontSize: 13 }}>▢</span><span style={{ fontSize: 13 }}>✕</span>
        </div>
      </div>
      {/* menu */}
      <div style={{ display: "flex", gap: 16, padding: "5px 12px", background: "#f0efec", borderBottom: "1px solid #d8d6d0", fontSize: 11.5, color: "#525252" }}>
        {["File", "Edit", "View", "Project", "Build", "Online", "Debug"].map((m) => <span key={m}>{m}</span>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "150px 1fr" }}>
        {/* device tree */}
        <div style={{ borderRight: "1px solid #d8d6d0", background: "#f6f5f2", padding: "8px 4px", minHeight: 250 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".05em", color: "#8a8a8a", padding: "2px 8px 6px" }}>DEVICES</div>
          {POUS.map((p, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", marginLeft: p.d * 12,
              fontSize: 10.5, fontFamily: p.f ? "var(--font-sans)" : "var(--font-mono)",
              color: p.active ? "#0D0D0D" : "#525252", background: p.active ? "#dbe8f7" : "transparent", borderRadius: 3,
            }}>
              <Icon d={p.f ? ICONS.cpu : p.b ? ICONS.block : p.g ? ICONS.file : ICONS.block} size={12}
                    stroke={p.b ? "#B45309" : p.g ? "#16A344" : "#5a8fc7"} />
              {p.n}
            </div>
          ))}
        </div>
        {/* ST editor */}
        <div style={{ background: "#fff", padding: "8px 0", fontFamily: "var(--font-mono)", fontSize: 10.5, lineHeight: "17px", whiteSpace: "nowrap" }}>
          {ST.map(([ln, segs], i) => (
            <div key={i} style={{ display: "flex" }}>
              <span style={{ width: 30, textAlign: "right", paddingRight: 10, color: "#bdb9b0", userSelect: "none" }}>{ln}</span>
              <span>{segs.map((s, j) => s.length ? <span key={j} style={{ color: stTint[s[0]] }}>{s[1]}</span> : <span key={j}>&nbsp;</span>)}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", background: "#f0efec", borderTop: "1px solid #d8d6d0", fontSize: 11, color: "#8a8a8a" }}>
        <span>Structured Text</span><span style={{ marginLeft: "auto" }}>Ln 8, Col 1</span>
      </div>
    </div>
  );
}

// ---- Volt app window — modern AI agent IDE (rail · analysis thread · file explorer) ----
const TREE = [
  { n: "src", d: 0, dir: 1 },
  { n: "PlcTask", d: 1, dir: 1 },
  { n: "POUs", d: 1, dir: 1 },
  { n: "fbd.fbd", d: 2, fb: 1 },
  { n: "PLC_PRG.st", d: 2, active: 1, diff: [2, 2] },
  { n: "References", d: 1, dir: 1 },
  { n: "External Types", d: 1, diff: [1, 1] },
  { n: "tests", d: 0, dir: 1 },
  { n: "package.json", d: 0 },
  { n: "README.md", d: 0 },
  { n: "tsconfig.json", d: 0 },
];

function MenuDots() {
  return (
    <span style={{ display: "inline-flex", gap: 2.5, marginLeft: "auto", alignItems: "center" }}>
      {[0, 1, 2].map((i) => <span key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: "#9b968c" }} />)}
    </span>
  );
}

function VoltWindow() {
  const tabs = ["Understand", "Debug", "Document", "Test", "Refactor"];
  const [tab, setTab] = React.useState("Understand");
  const sc = SCENARIOS[tab];
  const railIcon = (d) => <Icon d={d} size={16} stroke="#9b968c" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: 460 }}>
      {/* title bar / search */}
      <div className="dragbar" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--color-background)", borderBottom: "1px solid var(--color-border)", cursor: "grab", flex: "none" }}>
        <VoltMark size={14} color="var(--color-accent)" />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--color-success)", fontWeight: 500 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-success)" }} />Synced to CODESYS
        </span>
        <span style={{ flex: 1, maxWidth: 240, margin: "0 auto", display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--color-text-secondary)", background: "#fff", border: "1px solid var(--color-border)", borderRadius: 8, padding: "5px 10px" }}>
          <Icon d="M11 11a6 6 0 1 0-6-6 6 6 0 0 0 6 6zM20 20l-3.5-3.5" size={13} stroke="#9b968c" />
          Search project
          <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#bdb9b0" }}>⌘K</span>
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "46px 1fr 210px", flex: 1, minHeight: 0 }}>
        {/* icon rail */}
        <div style={{ borderRight: "1px solid var(--color-border)", background: "var(--color-background)", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "12px 0" }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--color-accent)", color: "#fff", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>P</div>
          {railIcon("M12 5v14M5 12h14")}
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            {railIcon(["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7"])}
            {railIcon(["M12 17h.01", "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"])}
          </div>
        </div>

        {/* analysis thread + composer */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "#fff" }}>
          <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "11px 16px", borderBottom: "1px solid var(--color-border)" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-text-primary)" }}>Project analysis</span>
            <span style={{ width: 11, height: 11, borderRadius: "50%", border: "2px solid var(--color-border)", borderTopColor: "var(--color-accent)" }} />
            <MenuDots />
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
            {/* user message */}
            <div style={{ alignSelf: "flex-end", maxWidth: "82%", background: "var(--color-text-primary)", color: "#fff", borderRadius: "12px 12px 4px 12px", padding: "9px 13px", fontSize: 13.5, lineHeight: "19px" }}>
              {sc.prompt}
            </div>
            {/* context chip */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>
              <Icon d={ICONS.folder} size={13} stroke="#9b968c" />
              Read {sc.tag.toLowerCase()} · whole-project context
            </div>
            {/* assistant message */}
            <div style={{ display: "flex", gap: 10, maxWidth: "94%" }}>
              <div style={{ flex: "none", width: 24, height: 24, borderRadius: 6, background: "var(--color-surface)", border: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <VoltMark size={12} color="var(--color-accent)" />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>{sc.title}</div>
                {sc.body.map((b, i) => (
                  <div key={i} style={{ display: "flex", gap: 8 }}>
                    <Icon d={ICONS.check} size={14} stroke="var(--color-success)" />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{b.h}</div>
                      <div style={{ fontSize: 13, lineHeight: "18px", color: "var(--color-text-secondary)", marginTop: 1 }}>{b.t}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* composer */}
          <div style={{ flex: "none", borderTop: "1px solid var(--color-border)", padding: "10px 14px 12px", background: "#fff" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 9 }}>
              {tabs.map((t) => (
                <button key={t} onClick={() => setTab(t)} style={{
                  border: `1px solid ${t === tab ? "var(--color-accent)" : "var(--color-border)"}`,
                  background: t === tab ? "rgba(217,119,6,0.08)" : "var(--color-background)", cursor: "pointer",
                  fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 500, padding: "4px 10px", borderRadius: 999,
                  color: t === tab ? "var(--color-accent-hover)" : "var(--color-text-secondary)",
                }}>{t}</button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--color-border)", borderRadius: 10, padding: "8px 8px 8px 12px", background: "var(--color-background)" }}>
              <span style={{ flex: 1, fontSize: 13, color: "var(--color-text-secondary)" }}>Ask anything…</span>
              <span style={{ width: 28, height: 28, borderRadius: 7, background: "var(--color-accent)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Icon d="M12 19V5M5 12l7-7 7 7" size={15} stroke="#fff" />
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
              {["Build", "Claude Sonnet", "Default"].map((m) => (
                <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 500, color: "var(--color-text-secondary)", background: "var(--color-background)", border: "1px solid var(--color-border)", borderRadius: 7, padding: "4px 9px" }}>
                  {m}<span style={{ color: "#bdb9b0" }}>▾</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* file explorer */}
        <div style={{ borderLeft: "1px solid var(--color-border)", background: "var(--color-background)", padding: "11px 8px", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 4px 10px" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>Files</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--color-accent)" }}>6 changes</span>
          </div>
          {TREE.map((f, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "3.5px 6px", marginLeft: f.d * 12, borderRadius: 5,
              fontSize: 12, fontFamily: f.dir ? "var(--font-sans)" : "var(--font-mono)",
              color: f.active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              background: f.active ? "var(--color-surface-hover)" : "transparent", fontWeight: f.active ? 600 : 400,
            }}>
              <Icon d={f.dir ? ICONS.folder : f.fb ? ICONS.block : ICONS.file} size={13}
                    stroke={f.active ? "var(--color-accent)" : f.dir ? "#9b968c" : "#bdb9b0"} />
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.n}</span>
              {f.diff && <span style={{ marginLeft: "auto", display: "flex", gap: 4, fontFamily: "var(--font-mono)", fontSize: 10 }}>
                <span style={{ color: "var(--color-success)" }}>+{f.diff[0]}</span>
                <span style={{ color: "var(--color-link)" }}>-{f.diff[1]}</span>
              </span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HeroMockup() {
  const [voltPos, voltDown] = useDrag({ x: 0, y: 36 });
  const [codePos, codeDown] = useDrag({ x: 610, y: 300 });
  const [front, setFront] = React.useState("code");

  // only start drag from the title bar
  const bar = (handler) => (e) => { if (e.target.closest(".dragbar")) handler(e); };

  return (
    <div style={{ position: "relative", height: 560, width: "100%", margin: "0 auto", textAlign: "left" }}>
      {/* Volt app — prominent foreground */}
      <Win pos={voltPos} onDown={bar(voltDown)} onFocus={() => setFront("volt")} z={front === "volt" ? 3 : 2} width={820}>
        <div onMouseDown={bar(voltDown)}><VoltWindow /></div>
      </Win>

      {/* CODESYS — small, bottom-right, overlapping */}
      <Win pos={codePos} onDown={bar(codeDown)} onFocus={() => setFront("code")} z={front === "code" ? 3 : 1} width={460}>
        <div onMouseDown={bar(codeDown)} style={{ fontSize: 11 }}><CodesysWindow /></div>
      </Win>
    </div>
  );
}
window.HeroMockup = HeroMockup;
