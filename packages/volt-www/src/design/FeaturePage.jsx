// Interior feature pages — product-led, detailed layouts.
// Content authored from the Volt product (v5 brief) + product knowledge of each feature.
// Each feature-*.html sets window.__FEATURE to a slug below.

// ---------- Reusable visual building blocks ----------
const FPanel = ({ label, dark, children, style }) => (
  <div style={{
    background: dark ? "#0D0D0D" : "#fff",
    border: `1px solid ${dark ? "#262626" : "var(--color-border)"}`,
    borderRadius: 14, boxShadow: dark ? "0 18px 48px rgba(13,13,13,0.18)" : "var(--shadow-md)", overflow: "hidden", ...style,
  }}>
    {label && (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${dark ? "#262626" : "var(--color-border)"}`, background: dark ? "#171717" : "var(--color-background)", fontFamily: "var(--font-mono)", fontSize: 12, color: dark ? "#8a8a8a" : "var(--color-text-secondary)" }}>
        {label}
      </div>
    )}
    <div style={{ padding: 18 }}>{children}</div>
  </div>
);
const L = ({ children, c = "var(--color-text-primary)" }) => (
  <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: "23px", color: c, whiteSpace: "pre-wrap" }}>{children}</div>
);
const A = ({ children }) => <span style={{ color: "var(--color-accent)" }}>{children}</span>;
const OK = ({ children }) => <span style={{ color: "var(--color-success)" }}>{children}</span>;
const DIM = ({ children }) => <span style={{ color: "#8a8a8a" }}>{children}</span>;

// Terminal window visual
const Terminal = ({ title = "volt", lines }) => (
  <FPanel dark label={title}>
    {lines.map((ln, i) => <L key={i} c="#e5e5e5">{ln}</L>)}
  </FPanel>
);

// ST / structured-code visual
const CodeMock = ({ label, rows }) => (
  <FPanel label={label}>
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: "21px" }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex" }}>
          <span style={{ width: 26, textAlign: "right", paddingRight: 12, color: "#bdb9b0", userSelect: "none" }}>{i + 1}</span>
          <span style={{ color: "var(--color-text-primary)" }}>{r}</span>
        </div>
      ))}
    </div>
  </FPanel>
);

// Horizontal flow diagram
const Flow = ({ steps, dark }) => (
  <div style={{ display: "flex", alignItems: "stretch", flexWrap: "wrap", gap: 0 }}>
    {steps.map((s, i) => (
      <React.Fragment key={i}>
        <div style={{
          flex: "1 1 0", minWidth: 130, background: dark ? "#171717" : "var(--color-surface)",
          border: `1px solid ${dark ? "#262626" : "var(--color-border)"}`, borderRadius: 12, padding: "16px 14px",
        }}>
          <Icon d={ICONS[s.icon]} size={18} stroke={s.hot ? "var(--color-accent)" : (dark ? "#d4d4d4" : "#9b968c")} />
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 10, color: dark ? "#fff" : "var(--color-text-primary)" }}>{s.t}</div>
          {s.s && <div style={{ fontSize: 12, marginTop: 3, fontFamily: "var(--font-mono)", color: dark ? "#8a8a8a" : "var(--color-text-secondary)" }}>{s.s}</div>}
        </div>
        {i < steps.length - 1 && <div style={{ display: "flex", alignItems: "center", padding: "0 5px", color: dark ? "#525252" : "#bdb9b0" }}><Icon d="M5 12h14M13 6l6 6-6 6" size={16} stroke={dark ? "#525252" : "#bdb9b0"} /></div>}
      </React.Fragment>
    ))}
  </div>
);

// "Ask Volt" chat visual
const ChatMock = ({ prompt, title, points }) => (
  <FPanel label="ask volt">
    <div style={{ alignSelf: "flex-end", display: "inline-block", maxWidth: "88%", background: "var(--color-text-primary)", color: "#fff", borderRadius: "12px 12px 4px 12px", padding: "8px 12px", fontSize: 13.5, lineHeight: "19px", float: "right" }}>{prompt}</div>
    <div style={{ clear: "both", height: 12 }} />
    <div style={{ display: "flex", gap: 10 }}>
      <div style={{ flex: "none", width: 24, height: 24, borderRadius: 6, background: "var(--color-surface)", border: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "center" }}><VoltMark size={12} color="var(--color-accent)" /></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        {points.map((p, i) => (
          <div key={i} style={{ display: "flex", gap: 8 }}>
            <Icon d={ICONS.check} size={14} stroke="var(--color-success)" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.h}</div>
              <div style={{ fontSize: 13, lineHeight: "18px", color: "var(--color-text-secondary)", marginTop: 1 }}>{p.t}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </FPanel>
);

// ---------- Page content ----------
const FEATURE_PAGES = {
  "project-understanding": {
    eyebrow: "Understand every PLC project",
    title: "AI that understands your whole project, not one file at a time",
    subtitle: "Volt mirrors the complete PLC project into a local repository and reasons across every program, function block, dependency, and safety chain — the way an experienced engineer does.",
    hero: <ChatMock prompt="Explain this project" title="Project summary" points={[
      { h: "Architecture", t: "3 programs orchestrated by Main, 2 reusable function blocks." },
      { h: "Dependencies", t: "Conveyor depends on Safety.OK and FB_Motor." },
      { h: "Risks", t: "MotorSpeed written from 2 POUs without an interlock." },
    ]} />,
    sections: [
      {
        title: "Whole-project context, always",
        body: "Most AI tools see the file that's open. Volt loads the entire project — tasks, POUs, global variables, and references — so every answer is grounded in the real system instead of a fragment.",
        points: ["Reads every POU, task, and global", "Resolves references across the project", "Answers grounded in real structure, not guesses"],
        visual: <Terminal title="volt — indexing" lines={[
          <span><A>$</A> volt index</span>,
          <OK>✓ 8 POUs · 2 function blocks · 1 GVL</OK>,
          <OK>✓ Dependency graph built</OK>,
          <OK>✓ Safety chain mapped</OK>,
          <DIM>Ready — ask anything about the project</DIM>,
        ]} />,
      },
      {
        title: "See impact before you change anything",
        body: "Ask what happens if you retype a variable or rename a block, and Volt traces every reader and writer across the project first — so refactors stop being guesswork.",
        points: ["Every reader and writer of a symbol", "Cross-POU and cross-project reasoning", "Impact reports before you commit"],
        reverse: true,
        visual: <ChatMock prompt="What reads MotorSpeed?" title="Impact analysis" points={[
          { h: "3 readers", t: "Conveyor, FB_Motor, and Alarms reference it directly." },
          { h: "1 writer", t: "Main sets it during recipe load — safe to retype." },
          { h: "Recommendation", t: "Update Alarms.Overspeed threshold to match." },
        ]} />,
      },
      {
        title: "Make sense of legacy projects fast",
        body: "Inherit a decade-old machine with no documentation? Volt reconstructs the architecture, maps dependencies, and drafts documentation so you can be productive in hours, not weeks.",
        points: ["Architecture reconstruction", "Dependency graphs from real code", "Documentation drafted from the project"],
        visual: <Flow steps={[
          { icon: "folder", t: "Legacy project", s: "no docs" },
          { icon: "cpu", t: "Volt analysis", s: "index + map", hot: true },
          { icon: "doc", t: "Docs + graph", s: "ready to read" },
        ]} />,
      },
    ],
    topicsTitle: "Everything in project understanding",
    topics: [
      { icon: "cpu", t: "Project-wide intelligence", d: "Reason over the whole project at once." },
      { icon: "git", t: "Dependency analysis", d: "Trace what reads and writes every symbol." },
      { icon: "folder", t: "Legacy understanding", d: "Make sense of undocumented projects fast." },
      { icon: "check", t: "Safety chains", d: "Volt recognizes interlocks and safety logic." },
      { icon: "block", t: "Cross-project reasoning", d: "Work across multiple projects together." },
      { icon: "doc", t: "Documentation generation", d: "Living docs generated from real structure." },
    ],
    quote: "AI understands projects the way engineers do.",
  },

  "ai-native-plc-languages": {
    eyebrow: "AI-Native PLC Languages",
    title: "Graphical PLC logic that both humans and AI can actually read",
    subtitle: "Ladder Logic and Function Blocks become structured, human-readable representations inspired by Structured Text. This is the foundation everything else in Volt is built on.",
    hero: <CodeMock label="Ladder rung → structured representation" rows={[
      "(* ──┤ Start ├──┤/ Estop ├──( Run ) *)",
      "Run := Start AND NOT Estop;",
      "",
      "(* Function block, resolved *)",
      "FB_Motor(Speed := MotorSpeed,",
      "         Run   := Enable AND Safety.OK);",
    ]} />,
    sections: [
      {
        title: "Ladder and Function Blocks, made legible",
        body: "Graphical languages are how much of the world's automation is written — and exactly what generic AI can't read. Volt translates rungs and FBD networks into a structured, ST-inspired form that stays faithful to the logic.",
        points: ["Ladder Logic support", "Function Block Diagram support", "Faithful to the original semantics"],
        visual: <Terminal title="volt — representation" lines={[
          <span><A>$</A> volt repr POUs/Conveyor.fbd</span>,
          <OK>✓ Rung network → structured text</OK>,
          <OK>✓ 12 contacts · 3 coils resolved</OK>,
          <DIM>Round-trips back to the IDE unchanged</DIM>,
        ]} />,
      },
      {
        title: "One representation, many capabilities",
        body: "Because the logic is now structured, AI can understand it, docs can be generated from it, and refactors can be validated against it. The same foundation feeds project, compiler, and future software-native workflows.",
        points: ["AI understanding of graphical logic", "Documentation generation", "Safe, reviewable refactoring"],
        reverse: true,
        visual: <Flow steps={[
          { icon: "block", t: "Graphical logic", s: "LD / FBD" },
          { icon: "doc", t: "ST-inspired form", s: "structured", hot: true },
          { icon: "cpu", t: "AI + docs + refactor", s: "enabled" },
        ]} />,
      },
      {
        title: "Cross-language reasoning",
        body: "Projects mix Ladder, FBD, and Structured Text. Volt reasons across all of them in one model, so a change in one language is understood everywhere it matters.",
        points: ["Unified model across languages", "Consistent naming and references", "No blind spots between LD, FBD, and ST"],
        visual: <CodeMock label="cross-language reference" rows={[
          "// FBD network references ST program",
          "Conveyor.Run  ← PLC_PRG.Enable",
          "Safety.OK      ← Safety.GuardClosed",
          "✓ resolved across 3 languages",
        ]} />,
      },
    ],
    topicsTitle: "Inside AI-Native PLC Languages",
    topics: [
      { icon: "block", t: "Ladder Logic support", d: "Rungs become clear structured logic." },
      { icon: "block", t: "Function Block support", d: "FBD networks become readable." },
      { icon: "doc", t: "ST-inspired representations", d: "A shared human-readable language." },
      { icon: "sync", t: "Cross-language reasoning", d: "One model across LD, FBD, and ST." },
      { icon: "cpu", t: "AI understanding", d: "AI can finally read graphical logic." },
      { icon: "check", t: "Safe refactoring", d: "Refactor graphical logic with confidence." },
    ],
    quote: "AI-Native PLC Languages are the foundation that enables project intelligence, compiler intelligence, and future software-native automation.",
  },

  "modern-engineering-workflows": {
    eyebrow: "Modern engineering workflows",
    title: "Bring modern software practices to automation — without changing how you work",
    subtitle: "Every mirrored project is a standard repository, so documentation, Git, testing, and the open developer ecosystem work out of the box. Your engineers keep working in the IDE they already use.",
    hero: <Terminal title="terminal — mirrored project" lines={[
      <span><A>$</A> bun test</span>,
      <OK>✓ FB_Motor ramps to target</OK>,
      <OK>✓ Safety chain latches on fault</OK>,
      <OK>✓ 3 passed in 41ms</OK>,
      <span><A>$</A> git commit -m "ci: add motor tests"</span>,
      <DIM>[main 4f2a9c1] ci: add motor tests</DIM>,
    ]} />,
    sections: [
      {
        title: "Documentation that stays current",
        body: "Generate architecture overviews, function-block references, and dependency maps directly from the project — as Markdown you can commit and review like any other artifact.",
        points: ["Architecture and I/O documentation", "Dependency maps as Markdown", "Committed and reviewed with the code"],
        visual: <ChatMock prompt="Generate documentation" title="Documentation drafted" points={[
          { h: "Architecture docs", t: "System overview and data-flow from structure." },
          { h: "Function block docs", t: "FB_Motor and FB_Conveyor with I/O tables." },
          { h: "Dependency map", t: "Exported as Markdown, ready to commit." },
        ]} />,
      },
      {
        title: "Version control that fits automation",
        body: "Branches, reviews, and history for PLC projects — with changes validated before they sync back to the IDE. Collaboration finally works the way software teams expect.",
        points: ["Real branches and pull requests", "Readable diffs on structured logic", "Validated before sync back"],
        reverse: true,
        visual: <CodeMock label="git diff — Conveyor" rows={[
          "  Run := Start AND NOT Estop;",
          "- MotorSpeed := 1500.0;",
          "+ MotorSpeed := Recipe.TargetRPM;",
          "  FB_Motor(Speed := MotorSpeed);",
        ]} />,
      },
      {
        title: "The whole open ecosystem, included",
        body: "A standard repository means npm packages, static analysis, CI/CD, and Git hooks just work. Volt builds on open standards instead of a walled garden.",
        points: ["Testing with bun test", "CI/CD pipelines", "Static analysis and Git hooks"],
        visual: <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {["bun test", "npm packages", "CI/CD", "static analysis", "Git hooks", "Markdown docs", "VS Code"].map((c) => (
            <span key={c} style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--color-text-secondary)", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 7, padding: "6px 11px" }}>{c}</span>
          ))}
        </div>,
      },
    ],
    topicsTitle: "Inside modern engineering workflows",
    topics: [
      { icon: "doc", t: "Documentation workflows", d: "Generate and maintain living docs." },
      { icon: "folder", t: "Open ecosystem", d: "Build on open standards and real tools." },
      { icon: "flask", t: "Testing strategies", d: "Test automation logic like software." },
      { icon: "terminal", t: "Tooling integrations", d: "Plug into modern developer tooling." },
      { icon: "git", t: "Modern practices", d: "Version control, review, and CI/CD." },
    ],
    quote: "Volt brings modern engineering workflows to industrial automation.",
  },

  "volt-git": {
    eyebrow: "Volt-git",
    title: "Your PLC project becomes a first-class software project",
    subtitle: "Volt-git is the synchronization engine that mirrors proprietary PLC environments into a modern repository — and keeps both sides in sync, with nothing lost on the round trip.",
    hero: <Flow steps={[
      { icon: "cpu", t: "PLC IDE", s: "Beckhoff · CODESYS" },
      { icon: "sync", t: "Volt-git", s: "mirror & sync", hot: true },
      { icon: "folder", t: "Software project", s: "local repo" },
      { icon: "cpu", t: "Compiler check", s: "validate" },
      { icon: "git", t: "Safe sync back", s: "to the IDE" },
    ]} />,
    sections: [
      {
        title: "Two-way synchronization you can trust",
        body: "Edit in the PLC IDE or in the mirrored repository — Volt-git keeps them consistent automatically, and every change is validated before it flows back to the IDE.",
        points: ["Automatic two-way sync", "Validation before write-back", "No manual export/import steps"],
        visual: <Terminal title="volt — sync" lines={[
          <span><A>$</A> volt sync --watch</span>,
          <OK>✓ CODESYS ⇄ repo in sync</OK>,
          <DIM>watching for changes…</DIM>,
          <OK>✓ Conveyor.st validated & synced</OK>,
        ]} />,
      },
      {
        title: "Nothing is lost on the round trip",
        body: "Layouts, comments, and IDE-specific metadata are preserved end to end, so a project that leaves the IDE returns identical — plus whatever you improved.",
        points: ["Metadata preservation", "Comments and layout retained", "Byte-faithful round trip"],
        reverse: true,
        visual: <CodeMock label="round-trip check" rows={[
          "export  → repo   ✓ metadata preserved",
          "edit    → repo   ✓ 2 changes",
          "import  → IDE    ✓ identical + changes",
          "diff (layout/comments): none",
        ]} />,
      },
      {
        title: "Collaboration on a real repository",
        body: "Because the project is a proper repository, teams get branches, reviews, and history — the collaboration workflows automation has been missing.",
        points: ["Branches and pull requests", "Shared history and blame", "A foundation for AI and validation"],
        visual: <Flow steps={[
          { icon: "git", t: "Branch", s: "feature/recipe" },
          { icon: "doc", t: "Review", s: "diff + comments", hot: true },
          { icon: "sync", t: "Merge & sync", s: "to IDE" },
        ]} />,
      },
    ],
    topicsTitle: "Inside Volt-git",
    topics: [
      { icon: "sync", t: "Synchronization engine", d: "Automatic two-way sync." },
      { icon: "folder", t: "Project mirroring", d: "The full project, mirrored locally." },
      { icon: "doc", t: "Metadata preservation", d: "Nothing lost on the round trip." },
      { icon: "cpu", t: "Multi-platform support", d: "Beckhoff and CODESYS today." },
      { icon: "git", t: "Collaboration workflows", d: "Branches, reviews, and history." },
      { icon: "block", t: "Future integrations", d: "A base for AI and validation." },
    ],
    quote: "Volt-git is the engineering bridge between industrial automation and modern software development.",
  },

  "compiler-intelligence": {
    eyebrow: "Compiler Intelligence",
    title: "Compiler-grade intelligence, not guesswork",
    subtitle: "Volt mirrors TwinCAT and CODESYS language semantics the way native IDEs do — type checking, symbol and namespace resolution, diagnostics, and reference tracking. Every change is validated before it reaches the PLC IDE.",
    hero: <Terminal title="volt — validate" lines={[
      <span><A>$</A> volt check Conveyor.st</span>,
      <OK>✓ Types resolved · 0 errors</OK>,
      <OK>✓ Symbols & namespaces resolved</OK>,
      <OK>✓ 14 references tracked</OK>,
      <DIM>Safe to synchronize to CODESYS</DIM>,
    ]} />,
    sections: [
      {
        title: "Native IDE semantics, mirrored",
        body: "Volt doesn't approximate — it mirrors how TwinCAT and CODESYS actually understand a project. Type checking, symbol resolution, and diagnostics match the IDE, so AI reasons over facts, not patterns.",
        points: ["TwinCAT and CODESYS semantics", "Type checking and diagnostics", "Symbol and namespace resolution"],
        visual: <CodeMock label="diagnostics" rows={[
          "MotorSpeed : REAL",
          "Recipe.TargetRPM : INT",
          "! implicit INT→REAL conversion (line 4)",
          "→ suggest explicit INT_TO_REAL()",
        ]} />,
      },
      {
        title: "Validate every change before it ships",
        body: "No change reaches the PLC IDE until it type-checks and resolves cleanly. Compiler Intelligence is the safety gate between AI-assisted edits and the live project.",
        points: ["Validation before synchronization", "Reference tracking across the project", "Errors caught before the IDE sees them"],
        reverse: true,
        visual: <Flow steps={[
          { icon: "cpu", t: "AI edit", s: "proposed" },
          { icon: "check", t: "Compiler check", s: "validate", hot: true },
          { icon: "sync", t: "Sync to IDE", s: "only if clean" },
        ]} />,
      },
      {
        title: "MCP is useful — but only one piece",
        body: "We don't attack MCP; it's a fine bridge for exposing tools. But a generic agent over MCP still sees files without language intelligence. Volt puts AI-native languages, Volt-git, and compiler knowledge underneath the AI.",
        points: ["Generic: PLC IDE → MCP → AI agent", "Volt: languages → git → compiler → AI", "AI reasons over compiler knowledge"],
        visual: <FPanel dark label="why volt">
          <L c="#8a8a8a">Generic</L>
          <L c="#e5e5e5">PLC IDE → MCP → Generic AI agent</L>
          <div style={{ height: 12 }} />
          <L c="var(--color-accent)">Volt</L>
          <L c="#e5e5e5">PLC IDE → AI-Native PLC Languages →</L>
          <L c="#e5e5e5">Volt-git → Compiler Intelligence →</L>
          <L c="#e5e5e5">Project Intelligence → AI</L>
        </FPanel>,
      },
    ],
    topicsTitle: "Inside Compiler Intelligence",
    topics: [
      { icon: "cpu", t: "TwinCAT semantics", d: "Mirrors TwinCAT understanding." },
      { icon: "cpu", t: "CODESYS semantics", d: "Mirrors CODESYS understanding." },
      { icon: "check", t: "Validation engine", d: "Validate before it reaches the IDE." },
      { icon: "doc", t: "Compiler diagnostics", d: "Type checks, symbols, diagnostics." },
      { icon: "sync", t: "Safe synchronization", d: "Only validated changes sync back." },
      { icon: "folder", t: "Project intelligence", d: "Reference tracking project-wide." },
    ],
    quote: "AI reasons over compiler knowledge instead of guessing.",
  },

  "engineering-with-confidence": {
    eyebrow: "Engineering with confidence",
    title: "AI-assisted engineering that stays understandable and predictable",
    subtitle: "See exactly what will change before it changes. Volt keeps every AI-assisted modification reviewable, validated, and safe — because automation is not the place for surprises.",
    hero: <ChatMock prompt="Refactor MotorSpeed to use the recipe value" title="Change plan" points={[
      { h: "Scope", t: "1 writer updated, 3 readers verified." },
      { h: "Safety", t: "No interlock or safety chain affected." },
      { h: "Validation", t: "Type-checks clean — ready to review." },
    ]} />,
    sections: [
      {
        title: "Every change comes with an impact report",
        body: "Before a refactor lands, Volt shows every reader and writer it touches and what stays untouched — so review is a glance, not an investigation.",
        points: ["Readers and writers, up front", "Cross-POU and cross-project scope", "Clear, reviewable change plans"],
        visual: <CodeMock label="impact report" rows={[
          "change: MotorSpeed source",
          "writers: 1 (Main)      ✓ updated",
          "readers: 3 (Conveyor, FB_Motor, Alarms)",
          "safety chains affected: 0",
        ]} />,
      },
      {
        title: "Safety-aware by design",
        body: "Volt recognizes safety chains and interlocks across the project and flags any change that would touch them — turning a class of dangerous edits into an explicit, deliberate decision.",
        points: ["Detects safety chains and interlocks", "Flags changes that affect them", "Nothing safety-critical changes silently"],
        reverse: true,
        visual: <Terminal title="volt — safety" lines={[
          <span><A>$</A> volt refactor --check-safety</span>,
          <OK>✓ Guard.Closed interlock intact</OK>,
          <OK>✓ Estop chain unaffected</OK>,
          <DIM>No safety-critical logic modified</DIM>,
        ]} />,
      },
      {
        title: "Modernize legacy without the risk",
        body: "Bring aging projects up to modern standards incrementally, with validation and cross-project checks at every step — no big-bang rewrite required.",
        points: ["Incremental legacy modernization", "Cross-project validation", "Predictable, reversible steps"],
        visual: <Flow steps={[
          { icon: "folder", t: "Legacy", s: "as-is" },
          { icon: "check", t: "Validated steps", s: "safe", hot: true },
          { icon: "cpu", t: "Modernized", s: "reviewable" },
        ]} />,
      },
    ],
    topicsTitle: "Inside engineering with confidence",
    topics: [
      { icon: "sync", t: "Safe refactoring", d: "Validated before it syncs." },
      { icon: "doc", t: "Change impact reports", d: "See what changes before it does." },
      { icon: "cpu", t: "Legacy modernization", d: "Modernize without rewrites." },
      { icon: "check", t: "Safety awareness", d: "Interlocks recognized project-wide." },
      { icon: "folder", t: "Cross-project validation", d: "Validate across projects at once." },
    ],
    quote: "AI-assisted engineering should always be understandable and predictable.",
  },

  "privacy-and-enterprise": {
    eyebrow: "Privacy & enterprise",
    title: "Your projects stay under your control",
    subtitle: "Local-first by default, bring-your-own-key by design, and built for the security, audit, and deployment requirements of industrial organizations.",
    hero: <Terminal title="volt — privacy" lines={[
      <span><A>$</A> volt config</span>,
      <OK>✓ Provider: bring-your-own-key</OK>,
      <OK>✓ Storage: local-first</OK>,
      <OK>✓ Telemetry: off</OK>,
      <DIM>Projects never leave your environment</DIM>,
    ]} />,
    sections: [
      {
        title: "Bring your own key, keep your data local",
        body: "Point Volt at your own AI provider and keys — no lock-in, no mandatory hosted model. Projects stay on your machine by default and never leave your environment without your say-so.",
        points: ["Bring your own AI provider (BYOK)", "Local-first storage by default", "No vendor lock-in"],
        visual: <Flow steps={[
          { icon: "folder", t: "Your project", s: "local" },
          { icon: "cpu", t: "Your key", s: "BYOK", hot: true },
          { icon: "check", t: "Your control", s: "no lock-in" },
        ]} />,
      },
      {
        title: "Built for teams and organizations",
        body: "SSO, centralized management, and full audit logs give security teams the visibility and control they need to roll Volt out across an organization.",
        points: ["Single sign-on (SSO)", "Centralized team management", "Full audit logs"],
        reverse: true,
        visual: <CodeMock label="audit log" rows={[
          "2026-07-15 09:12  a.eng@acme  sync Conveyor.st",
          "2026-07-15 09:14  a.eng@acme  validate ✓",
          "2026-07-15 10:02  lead@acme   review approved",
          "→ exported for compliance",
        ]} />,
      },
      {
        title: "Deploy the way you need to",
        body: "From local workstations to private, self-hosted deployments in regulated environments, Volt fits the compliance requirements of industrial organizations.",
        points: ["Private, self-hosted deployments", "Regulated-environment ready", "Compliance-focused controls"],
        visual: <Flow steps={[
          { icon: "cpu", t: "Local", s: "workstation" },
          { icon: "folder", t: "Self-hosted", s: "your infra", hot: true },
          { icon: "check", t: "Compliant", s: "audited" },
        ]} />,
      },
    ],
    topicsTitle: "Inside privacy & enterprise",
    topics: [
      { icon: "cpu", t: "BYOK", d: "Your own AI provider and keys." },
      { icon: "folder", t: "Local-first workflows", d: "Projects stay on your machine." },
      { icon: "doc", t: "Audit logs", d: "Visibility into every action." },
      { icon: "check", t: "SSO", d: "Single sign-on and team management." },
      { icon: "block", t: "Enterprise deployments", d: "Private, self-hosted options." },
      { icon: "sync", t: "Compliance", d: "Built for regulated organizations." },
    ],
    quote: "Your projects remain under your control.",
  },

  "desktop-and-cli": {
    eyebrow: "Desktop + CLI",
    title: "Two experiences. One platform.",
    subtitle: "A purpose-built desktop app for controls engineers, and a scriptable CLI for advanced developer workflows — both on the same Volt engine.",
    hero: <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <FPanel label="desktop app">
        <Icon d={ICONS.cpu} size={22} stroke="var(--color-accent)" />
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 12 }}>Built for controls engineers</div>
        <div style={{ fontSize: 13.5, lineHeight: "20px", color: "var(--color-text-secondary)", marginTop: 6 }}>AI workspace and project sync — no VS Code required.</div>
      </FPanel>
      <FPanel dark label="cli">
        <L c="#e5e5e5"><A>$</A> volt sync --watch</L>
        <L c="#8a8a8a">watching CODESYS project…</L>
        <L c="var(--color-success)">✓ in sync</L>
      </FPanel>
    </div>,
    sections: [
      {
        title: "The desktop app: purpose-built for the shop floor",
        body: "A dedicated engineering experience for controls engineers — an AI workspace, project sync, and everything Volt does, without needing to live in a code editor.",
        points: ["AI workspace for PLC projects", "One-click project sync", "No VS Code required"],
        visual: <ChatMock prompt="What changed since yesterday?" title="Recent changes" points={[
          { h: "Conveyor.st", t: "MotorSpeed now driven by recipe value." },
          { h: "Tests", t: "3 added — all passing." },
          { h: "Status", t: "Validated and synced to CODESYS." },
        ]} />,
      },
      {
        title: "The CLI: automation-friendly and scriptable",
        body: "For software-oriented engineers, the CLI brings Volt into the terminal and VS Code — perfect for CI pipelines, batch operations, and advanced developer workflows.",
        points: ["Terminal-first and scriptable", "VS Code integration", "Automation and CI tooling"],
        reverse: true,
        visual: <Terminal title="terminal" lines={[
          <span><A>$</A> volt check ./POUs --ci</span>,
          <OK>✓ 8 POUs validated</OK>,
          <span><A>$</A> volt docs --out ./docs</span>,
          <OK>✓ 4 documents written</OK>,
        ]} />,
      },
    ],
    topicsTitle: "One platform, two ways to work",
    topics: [
      { icon: "cpu", t: "Desktop app", d: "Purpose-built for controls engineers." },
      { icon: "terminal", t: "CLI", d: "Advanced workflows from the terminal." },
      { icon: "block", t: "VS Code integration", d: "Work inside the editor you use." },
      { icon: "git", t: "Automation tooling", d: "Scriptable and CI-friendly." },
    ],
    quote: "Two experiences. One platform.",
  },
};

function FeatureTopicCard({ icon, t, d }) {
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 14, padding: 22, textAlign: "left" }}>
      <Icon d={ICONS[icon]} size={20} stroke="var(--color-accent)" />
      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 14, color: "var(--color-text-primary)" }}>{t}</div>
      <div style={{ fontSize: 14, lineHeight: "21px", marginTop: 6, color: "var(--color-text-secondary)" }}>{d}</div>
    </div>
  );
}

function DeepDive({ title, body, points, visual, reverse }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center", padding: "48px 0", scrollMarginTop: 76 }}>
      <div style={{ order: reverse ? 2 : 1 }}>
        <h2 style={{ fontSize: 28, lineHeight: "36px", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-text-primary)", margin: 0, textWrap: "balance" }}>{title}</h2>
        <p style={{ fontSize: 16, lineHeight: "26px", color: "var(--color-text-secondary)", margin: "14px 0 0", maxWidth: 460, textWrap: "pretty" }}>{body}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
          {points.map((p) => (
            <div key={p} style={{ display: "flex", gap: 10, fontSize: 14.5, color: "var(--color-text-primary)" }}>
              <Icon d={ICONS.check} size={17} stroke="var(--color-success)" />{p}
            </div>
          ))}
        </div>
      </div>
      <div style={{ order: reverse ? 1 : 2 }}>{visual}</div>
    </div>
  );
}

function FeaturePage() {
  const { Button } = window.VoltDesignSystem_704691;
  const f = FEATURE_PAGES[window.__FEATURE];
  if (!f) return <Container style={{ padding: "120px 24px" }}>Unknown feature.</Container>;
  const keys = Object.keys(FEATURE_PAGES);
  const idx = keys.indexOf(window.__FEATURE);
  const next = FEATURE_PAGES[keys[(idx + 1) % keys.length]];
  const nextSlug = keys[(idx + 1) % keys.length];
  return (
    <React.Fragment>
      {/* Hero — two-column: copy + product visual */}
      <section style={{ borderBottom: "1px solid var(--color-border)" }}>
        <Container style={{ padding: "64px 24px 64px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent)", letterSpacing: ".02em" }}>{f.eyebrow}</div>
            <h1 style={{ fontSize: 44, lineHeight: "50px", fontWeight: 600, letterSpacing: "-0.03em", margin: "14px 0 0", color: "var(--color-text-primary)" }}>{f.title}</h1>
            <p style={{ fontSize: 18, lineHeight: "28px", color: "var(--color-text-secondary)", margin: "18px 0 0", maxWidth: 500, textWrap: "pretty" }}>{f.subtitle}</p>
            <div style={{ display: "flex", gap: 12, marginTop: 28 }}>
              {/* volt: Start Free → console /auth */}
              <a href={window.VOLT.authUrl()} style={{ textDecoration: "none", display: "inline-flex" }}><Button variant="primary" size="lg">Start Free</Button></a>
              <a href="index.html" style={{ textDecoration: "none", display: "inline-flex" }}><Button variant="outline" size="lg">Back to overview</Button></a>
            </div>
          </div>
          <div>{f.hero}</div>
        </Container>
      </section>

      {/* Deep-dive sections */}
      <Container style={{ padding: "16px 24px 24px" }}>
        {f.sections.map((s, i) => <DeepDive key={i} {...s} />)}
      </Container>

      {/* Capability grid */}
      <section style={{ background: "var(--color-background)", borderTop: "1px solid var(--color-border)" }}>
        <Container style={{ padding: "64px 24px" }}>
          <SectionTitle style={{ marginBottom: 28 }}>{f.topicsTitle}</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {f.topics.map((t) => <FeatureTopicCard key={t.t} {...t} />)}
          </div>
        </Container>
      </section>

      {/* Core-message band + next feature */}
      <section style={{ background: "#0D0D0D", color: "var(--color-text-on-dark)" }}>
        <Container style={{ padding: "72px 24px", textAlign: "center" }}>
          <VoltMark size={28} color="var(--color-accent)" />
          <blockquote style={{ fontSize: 30, lineHeight: "40px", fontWeight: 600, letterSpacing: "-0.02em", color: "#fff", margin: "20px auto 0", maxWidth: 720, textWrap: "balance" }}>
            “{f.quote}”
          </blockquote>
          <a href={`feature-${nextSlug}.html`} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 32, fontSize: 15, fontWeight: 500, color: "var(--color-accent)", textDecoration: "none" }}>
            Next: {next.eyebrow} <Icon d="M5 12h14M13 6l6 6-6 6" size={16} stroke="var(--color-accent)" />
          </a>
        </Container>
      </section>
    </React.Fragment>
  );
}

window.FeaturePage = FeaturePage;
