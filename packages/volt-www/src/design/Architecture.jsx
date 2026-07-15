// Volt-git bridge + Compiler Intelligence + Engineering with confidence + Privacy + product surfaces
function Architecture() {
  const steps = [
    { t: "PLC IDE", s: "Beckhoff · CODESYS", icon: "cpu" },
    { t: "Volt-git", s: "Mirror & sync", icon: "sync" },
    { t: "Software-native project", s: "Local repository", icon: "folder" },
    { t: "Compiler Intelligence", s: "Validation", icon: "cpu" },
    { t: "Safe sync back", s: "To the PLC IDE", icon: "git" },
  ];
  return (
    <section id="volt-git" style={{ background: "#0D0D0D", color: "var(--color-text-on-dark)", scrollMarginTop: 76 }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "88px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent)", letterSpacing: ".02em" }}>Volt-git</div>
        <h2 style={{ fontSize: 36, lineHeight: "44px", fontWeight: 600, letterSpacing: "-0.02em", margin: "12px auto 0", maxWidth: 660, textWrap: "balance" }}>
          The engineering bridge between automation and software development
        </h2>
        <p style={{ fontSize: 16, lineHeight: "26px", color: "#a8a8a8", maxWidth: 560, margin: "16px auto 0" }}>
          Your PLC project becomes a first-class software project — mirrored, metadata preserved, and kept in sync both ways.
        </p>
        <div style={{ display: "flex", alignItems: "stretch", justifyContent: "center", gap: 0, marginTop: 52, flexWrap: "wrap" }}>
          {steps.map((st, i) => (
            <React.Fragment key={i}>
              <div style={{ flex: "1 1 0", minWidth: 150, background: "#171717", border: "1px solid #262626", borderRadius: 12, padding: "20px 16px", textAlign: "left" }}>
                <Icon d={ICONS[st.icon]} size={20} stroke={i === 1 ? "var(--color-accent)" : "#d4d4d4"} />
                <div style={{ fontSize: 15, fontWeight: 600, marginTop: 14, color: "#fff" }}>{st.t}</div>
                <div style={{ fontSize: 12.5, color: "#8a8a8a", marginTop: 4, fontFamily: "var(--font-mono)" }}>{st.s}</div>
              </div>
              {i < steps.length - 1 && (
                <div style={{ display: "flex", alignItems: "center", padding: "0 6px", color: "#525252" }}>
                  <Icon d="M5 12h14M13 6l6 6-6 6" size={18} stroke="#525252" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
        <a href="feature-volt-git.html" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 32, fontSize: 14, fontWeight: 500, color: "var(--color-accent)", textDecoration: "none" }}>
          Learn more <Icon d="M5 12h14M13 6l6 6-6 6" size={15} stroke="var(--color-accent)" />
        </a>
      </div>
    </section>
  );
}

// Compiler Intelligence — capabilities + the MCP comparison (never attack, just contrast)
function CompilerIntelligence() {
  const caps = ["Type checking", "Symbol resolution", "Namespace resolution", "Diagnostics", "Reference tracking", "Validation before sync"];
  return (
    <section id="compiler" style={{ maxWidth: 1120, margin: "0 auto", padding: "80px 24px 40px", scrollMarginTop: 76 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent)", letterSpacing: ".02em" }}>Compiler Intelligence</div>
          <h2 style={{ fontSize: 32, lineHeight: "40px", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-text-primary)", margin: "12px 0 0", textWrap: "balance" }}>
            AI reasons over compiler knowledge, not guesses
          </h2>
          <p style={{ fontSize: 16, lineHeight: "26px", color: "var(--color-text-secondary)", margin: "14px 0 0", maxWidth: 440, textWrap: "pretty" }}>
            Volt mirrors TwinCAT and CODESYS language semantics the way native IDEs do. Every change can be validated before it reaches the PLC IDE.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20 }}>
            {caps.map((c) => (
              <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-text-secondary)", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 999, padding: "6px 12px" }}>
                <Icon d={ICONS.check} size={14} stroke="var(--color-success)" />{c}
              </span>
            ))}
          </div>
          <a href="feature-compiler-intelligence.html" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 20, fontSize: 14, fontWeight: 500, color: "var(--color-link)", textDecoration: "none" }}>
            Learn more <Icon d="M5 12h14M13 6l6 6-6 6" size={15} stroke="var(--color-link)" />
          </a>
        </div>
        <Panel label="why volt — MCP is one piece of the puzzle">
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: ".02em" }}>GENERIC APPROACH</div>
          <Mono color="var(--color-text-secondary)">PLC IDE → MCP → Generic AI agent</Mono>
          <div style={{ height: 16 }} />
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-accent)", letterSpacing: ".02em" }}>VOLT</div>
          <Mono>PLC IDE → AI-Native PLC Languages →</Mono>
          <Mono>Volt-git → Compiler Intelligence →</Mono>
          <Mono>Project Intelligence → AI</Mono>
          <div style={{ height: 8 }} />
          <Mono color="var(--color-success)">✓ AI reasons over compiler knowledge</Mono>
        </Panel>
      </div>
    </section>
  );
}

// Simple topic-card grid used by Confidence + Privacy
function TopicGrid({ items, dark }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 40 }}>
      {items.map((it) => (
        <div key={it.t} style={{
          background: dark ? "#171717" : "var(--color-surface)",
          border: `1px solid ${dark ? "#262626" : "var(--color-border)"}`,
          borderRadius: 14, padding: 22, textAlign: "left",
        }}>
          <Icon d={ICONS[it.icon]} size={20} stroke="var(--color-accent)" />
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 14, color: dark ? "#fff" : "var(--color-text-primary)" }}>{it.t}</div>
          <div style={{ fontSize: 14, lineHeight: "21px", marginTop: 6, color: dark ? "#a8a8a8" : "var(--color-text-secondary)" }}>{it.d}</div>
        </div>
      ))}
    </div>
  );
}

function EngineeringConfidence() {
  const items = [
    { icon: "sync", t: "Safe refactoring", d: "Rename, restructure, and modernize with changes validated before they sync." },
    { icon: "doc", t: "Change impact reports", d: "See every reader and writer affected before you commit a change." },
    { icon: "cpu", t: "Legacy modernization", d: "Bring aging projects into modern workflows without rewriting them." },
    { icon: "check", t: "Safety awareness", d: "Volt recognizes safety chains and interlocks across the project." },
    { icon: "folder", t: "Cross-project validation", d: "Reason and validate across multiple projects at once." },
    { icon: "block", t: "Predictable results", d: "AI-assisted engineering that stays understandable and reviewable." },
  ];
  return (
    <section id="confidence" style={{ maxWidth: 1120, margin: "0 auto", padding: "80px 24px 40px", scrollMarginTop: 76 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent)", letterSpacing: ".02em" }}>Engineering with confidence</div>
        <h2 style={{ fontSize: 32, lineHeight: "40px", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-text-primary)", margin: "12px auto 0", maxWidth: 620, textWrap: "balance" }}>
          AI-assisted engineering should always be understandable and predictable
        </h2>
      </div>
      <TopicGrid items={items} />
      <div style={{ textAlign: "center", marginTop: 28 }}>
        <a href="feature-engineering-with-confidence.html" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 500, color: "var(--color-link)", textDecoration: "none" }}>
          Learn more <Icon d="M5 12h14M13 6l6 6-6 6" size={15} stroke="var(--color-link)" />
        </a>
      </div>
    </section>
  );
}

function Privacy() {
  const items = [
    { icon: "cpu", t: "BYOK", d: "Bring your own AI provider and keys — no lock-in." },
    { icon: "folder", t: "Local-first workflows", d: "Your projects stay on your machine by default." },
    { icon: "doc", t: "Audit logs", d: "Full visibility into every action across your team." },
    { icon: "check", t: "SSO", d: "Single sign-on and centralized team management." },
    { icon: "block", t: "Enterprise deployments", d: "Private, self-hosted deployments for regulated environments." },
    { icon: "sync", t: "Compliance", d: "Built for the requirements of industrial organizations." },
  ];
  return (
    <section id="privacy" style={{ background: "#0D0D0D", color: "var(--color-text-on-dark)", scrollMarginTop: 76 }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "80px 24px" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent)", letterSpacing: ".02em" }}>Privacy & enterprise</div>
          <h2 style={{ fontSize: 32, lineHeight: "40px", fontWeight: 600, letterSpacing: "-0.02em", color: "#fff", margin: "12px auto 0", maxWidth: 560, textWrap: "balance" }}>
            Your projects remain under your control
          </h2>
        </div>
        <TopicGrid items={items} dark />
        <div style={{ textAlign: "center", marginTop: 28 }}>
          <a href="feature-privacy-and-enterprise.html" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 500, color: "var(--color-accent)", textDecoration: "none" }}>
            Learn more <Icon d="M5 12h14M13 6l6 6-6 6" size={15} stroke="var(--color-accent)" />
          </a>
        </div>
      </div>
    </section>
  );
}

function Surfaces() {
  return (
    <section id="surfaces" style={{ maxWidth: 1120, margin: "0 auto", padding: "80px 24px 40px", scrollMarginTop: 76 }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent)", letterSpacing: ".02em" }}>Desktop + CLI</div>
        <h2 style={{ fontSize: 32, lineHeight: "40px", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-text-primary)", margin: "12px auto 0", maxWidth: 520, textWrap: "balance" }}>
          Two experiences. One platform.
        </h2>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div id="desktop" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 16, padding: 28, scrollMarginTop: 90 }}>
          <Icon d={ICONS.cpu} size={22} stroke="var(--color-accent)" />
          <h3 style={{ fontSize: 22, fontWeight: 600, margin: "16px 0 0", color: "var(--color-text-primary)" }}>Desktop app</h3>
          <p style={{ fontSize: 15, lineHeight: "24px", color: "var(--color-text-secondary)", margin: "8px 0 0" }}>
            Purpose-built for controls engineers. AI workspace and project sync — no VS&nbsp;Code required.
          </p>
        </div>
        <div id="cli" style={{ background: "#0D0D0D", borderRadius: 16, padding: 28, scrollMarginTop: 90 }}>
          <Icon d={ICONS.terminal} size={22} stroke="var(--color-accent)" />
          <h3 style={{ fontSize: 22, fontWeight: 600, margin: "16px 0 0", color: "#fff" }}>CLI + VS Code</h3>
          <p style={{ fontSize: 15, lineHeight: "24px", color: "#a8a8a8", margin: "8px 0 12px" }}>
            Advanced developer workflows with VS&nbsp;Code integration and automation tooling.
          </p>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "#d4d4d4", background: "#171717", border: "1px solid #262626", borderRadius: 8, padding: "10px 12px" }}>
            <span style={{ color: "var(--color-accent)" }}>$</span> volt sync --watch
          </div>
        </div>
      </div>
      <div style={{ textAlign: "center", marginTop: 28 }}>
        <a href="feature-desktop-and-cli.html" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 500, color: "var(--color-link)", textDecoration: "none" }}>
          Learn more <Icon d="M5 12h14M13 6l6 6-6 6" size={15} stroke="var(--color-link)" />
        </a>
      </div>
    </section>
  );
}

window.Architecture = Architecture;
window.CompilerIntelligence = CompilerIntelligence;
window.EngineeringConfidence = EngineeringConfidence;
window.Privacy = Privacy;
window.Surfaces = Surfaces;
