// "Works with the tools you already run" — vendor strip, styled to match sections below
function VendorCard({ name }) {
  const [h, setH] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, height: 92,
        background: h ? "#fff" : "var(--color-surface)",
        border: `1px solid ${h ? "var(--color-accent)" : "var(--color-border)"}`,
        borderRadius: 12, padding: "0 8px", cursor: "default",
        boxShadow: h ? "var(--shadow-md)" : "none", transition: "all 140ms ease",
      }}>
      <Icon d={ICONS.cpu} size={17} stroke={h ? "var(--color-accent)" : "#9b968c"} />
      <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--color-text-primary)", textAlign: "center", lineHeight: "16px" }}>{name}</span>
    </div>
  );
}

function BuiltFor() {
  const vendors = ["Beckhoff", "CODESYS", "Lenze", "Wago", "Schneider", "Keba"];
  return (
    <section id="platforms" style={{ maxWidth: 1120, margin: "0 auto", padding: "88px 24px 72px", textAlign: "center", scrollMarginTop: 76 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent)", letterSpacing: ".02em" }}>Works with</div>
      <h2 style={{ fontSize: 32, lineHeight: "40px", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-text-primary)", margin: "12px auto 0", maxWidth: 560, textWrap: "balance" }}>
        Works with the tools you already run
      </h2>
      <p style={{ fontSize: 16, lineHeight: "26px", color: "var(--color-text-secondary)", maxWidth: 520, margin: "14px auto 0", textWrap: "pretty" }}>
        Beckhoff and CODESYS today, with Lenze, Wago, Schneider, and Keba — plus the engineering tools you already use. More platforms are on the roadmap.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginTop: 36 }}>
        {vendors.map((v) => <VendorCard key={v} name={v} />)}
      </div>
      <a href="#" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 28, fontSize: 14, fontWeight: 500, color: "var(--color-link)", textDecoration: "none" }}>
        See the platform roadmap <Icon d="M5 12h14M13 6l6 6-6 6" size={15} stroke="var(--color-link)" />
      </a>
    </section>
  );
}

// Generic feature row: text one side, product-interaction mock the other
function FeatureRow({ eyebrow, title, body, reverse, anchor, href, children }) {
  return (
    <div id={anchor} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center", padding: "56px 0", scrollMarginTop: 76 }}>
      <div style={{ order: reverse ? 2 : 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent)", letterSpacing: ".02em" }}>{eyebrow}</div>
        <h2 style={{ fontSize: 32, lineHeight: "40px", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-text-primary)", margin: "12px 0 0", textWrap: "balance" }}>{title}</h2>
        <p style={{ fontSize: 16, lineHeight: "26px", color: "var(--color-text-secondary)", margin: "14px 0 0", maxWidth: 440, textWrap: "pretty" }}>{body}</p>
        <a href={href} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 18, fontSize: 14, fontWeight: 500, color: "var(--color-link)", textDecoration: "none" }}>
          Learn more <Icon d="M5 12h14M13 6l6 6-6 6" size={15} stroke="var(--color-link)" />
        </a>
      </div>
      <div style={{ order: reverse ? 1 : 2 }}>{children}</div>
    </div>
  );
}

// Reusable mock panel frame
const Panel = ({ children, label }) => (
  <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: 14, boxShadow: "var(--shadow-md)", overflow: "hidden" }}>
    {label && (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--color-border)", background: "var(--color-background)", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--color-text-secondary)" }}>
        {label}
      </div>
    )}
    <div style={{ padding: 16 }}>{children}</div>
  </div>
);

const Mono = ({ children, color = "var(--color-text-primary)" }) => (
  <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: "22px", color }}>{children}</div>
);

// "What this enables" chip used in the ecosystem panel
const EnableChip = ({ children }) => (
  <span style={{ display: "inline-flex", alignItems: "center", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--color-text-secondary)", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "4px 9px" }}>{children}</span>
);

function Features() {
  return (
    <section style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 24px 40px" }}>
      <FeatureRow
        anchor="understand"
        href="feature-project-understanding.html"
        eyebrow="Understand every PLC project"
        title="AI understands projects the way engineers do"
        body="Volt understands complete PLC projects instead of isolated files — reasoning across dependencies, safety chains, and legacy code. Project-wide intelligence, impact analysis, and cross-project reasoning, grounded in the whole system.">
        <Panel label="ask volt">
          <Mono color="var(--color-accent)">&gt; Explain this project</Mono>
          <div style={{ height: 10 }} />
          <Mono color="var(--color-success)">✓ Packaging line identified</Mono>
          <Mono color="var(--color-success)">✓ Safety chain detected</Mono>
          <Mono color="var(--color-success)">✓ Dependency graph generated</Mono>
        </Panel>
      </FeatureRow>

      <FeatureRow reverse
        anchor="ai-native"
        href="feature-ai-native-plc-languages.html"
        eyebrow="AI-Native PLC Languages"
        title="Graphical PLC languages, readable by humans and AI"
        body="Ladder Logic and Function Blocks become structured, human-readable representations inspired by Structured Text. This foundation makes graphical logic understandable to AI — enabling better documentation, safer modifications, and cross-language reasoning.">
        <Panel label="ladder → structured representation">
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: ".02em" }}>LADDER RUNG</div>
          <Mono color="var(--color-text-secondary)">──┤ Start ├──┤/ Estop ├──( Run )──</Mono>
          <div style={{ height: 12, display: "flex", justifyContent: "center", color: "#bdb9b0" }}>
            <Icon d={ICONS.arrowDown} size={16} stroke="#bdb9b0" />
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-accent)", letterSpacing: ".02em" }}>AI-NATIVE REPRESENTATION</div>
          <Mono><span style={{ color: "#C2410C" }}>Run</span> := <span style={{ color: "#0D0D0D" }}>Start</span> <span style={{ color: "#C2410C" }}>AND NOT</span> <span style={{ color: "#0D0D0D" }}>Estop</span>;</Mono>
          <Mono color="var(--color-success)">✓ Readable by engineers and AI alike</Mono>
        </Panel>
      </FeatureRow>

      <FeatureRow
        anchor="workflows"
        href="feature-modern-engineering-workflows.html"
        eyebrow="Modern engineering workflows"
        title="Modern software practices, without changing how you work"
        body="Bring documentation generation, Git workflows, testing, and open-ecosystem tooling to industrial automation — without changing how engineers work today. Every mirrored project is a standard repository, so modern developer tooling works out of the box.">
        <Panel label="terminal — mirrored project">
          <Mono><span style={{ color: "var(--color-accent)" }}>$</span> bun test</Mono>
          <Mono color="var(--color-success)">✓ FB_Motor ramps to target</Mono>
          <Mono color="var(--color-success)">✓ Safety chain latches</Mono>
          <Mono><span style={{ color: "var(--color-accent)" }}>$</span> git commit -m "ci: add tests"</Mono>
          <div style={{ height: 14 }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <EnableChip>documentation</EnableChip>
            <EnableChip>Git workflows</EnableChip>
            <EnableChip>testing</EnableChip>
            <EnableChip>CI/CD</EnableChip>
            <EnableChip>open ecosystem</EnableChip>
          </div>
        </Panel>
      </FeatureRow>
    </section>
  );
}

window.BuiltFor = BuiltFor;
window.Features = Features;
window.Panel = Panel;
window.Mono = Mono;
