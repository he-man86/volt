// Pricing page extras: feature comparison matrix + pricing FAQ.
function ComparisonTable() {
  const plans = ["Free", "Pro", "Max", "Enterprise"];
  const groups = [
    {
      title: "Core",
      rows: [
        { f: "Beckhoff & CODESYS support", v: [true, true, true, true] },
        { f: "Project mirroring & sync", v: [true, true, true, true] },
        { f: "PLC-aware LSP", v: [true, true, true, true] },
        { f: "Desktop app + CLI + VS Code", v: [true, true, true, true] },
        { f: "Git, Bun & testing workflows", v: [true, true, true, true] },
      ],
    },
    {
      title: "AI",
      rows: [
        { f: "Bring your own provider", v: [true, true, true, true] },
        { f: "Hosted AI included", v: [false, true, true, true] },
        { f: "Premium models", v: [false, false, true, true] },
        { f: "Monthly AI usage", v: ["—", "Standard", "Increased", "Custom"] },
      ],
    },
    {
      title: "Team & governance",
      rows: [
        { f: "SSO & SCIM", v: [false, false, false, true] },
        { f: "Audit logs", v: [false, false, false, true] },
        { f: "Bring your own key (BYOK)", v: [false, false, false, true] },
        { f: "Support", v: ["Community", "Priority", "Priority", "Dedicated"] },
      ],
    },
  ];
  const Cell = ({ v }) => {
    if (v === true) return <Icon d={ICONS.check} size={16} stroke="var(--color-success)" />;
    if (v === false) return <span style={{ color: "var(--color-border)", fontSize: 18, lineHeight: 1 }}>·</span>;
    return <span style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>{v}</span>;
  };
  return (
    <Container style={{ padding: "72px 24px" }}>
      <SectionTitle style={{ textAlign: "center", marginBottom: 8 }}>Compare every plan</SectionTitle>
      <p style={{ fontSize: 16, color: "var(--color-text-secondary)", textAlign: "center", margin: "0 0 36px" }}>Everything in Volt, side by side.</p>
      <div style={{ border: "1px solid var(--color-border)", borderRadius: 16, overflow: "hidden", background: "#fff" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr repeat(4, 1fr)", alignItems: "center", padding: "16px 24px", background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" }}>Features</div>
          {plans.map((p) => <div key={p} style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", textAlign: "center" }}>{p}</div>)}
        </div>
        {groups.map((g) => (
          <React.Fragment key={g.title}>
            <div style={{ padding: "16px 24px 8px", fontSize: 12, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--color-accent)" }}>{g.title}</div>
            {g.rows.map((r, i) => (
              <div key={r.f} style={{ display: "grid", gridTemplateColumns: "1.6fr repeat(4, 1fr)", alignItems: "center", padding: "12px 24px", borderTop: i === 0 ? "none" : "1px solid var(--color-border)" }}>
                <div style={{ fontSize: 14.5, color: "var(--color-text-primary)" }}>{r.f}</div>
                {r.v.map((v, j) => <div key={j} style={{ display: "flex", justifyContent: "center" }}><Cell v={v} /></div>)}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </Container>
  );
}

function PricingFAQ() {
  const items = [
    { q: "What does “bring your own AI provider” mean?", a: "On the Free plan you connect your own API key from a provider like Anthropic or OpenAI. Volt uses it directly — you only pay your provider for usage. Pro, Max, and Enterprise include hosted AI so there's nothing to configure." },
    { q: "Do I need an internet connection to use Volt?", a: "Your project is mirrored to a local repository, so editing, language tooling, Git, and tests all work offline. Only AI requests need connectivity to your chosen provider." },
    { q: "Which PLC platforms are supported?", a: "Beckhoff and CODESYS are supported today. Siemens, Rockwell, Schneider, and Omron are on the roadmap and included in every plan when released." },
    { q: "Can I switch plans or cancel anytime?", a: "Yes. Plans are month-to-month with no lock-in. Upgrades take effect immediately and downgrades apply at the end of your billing cycle." },
    { q: "How does Enterprise pricing work?", a: "Enterprise is priced per organization based on seats and deployment needs. It adds SSO, audit logs, BYOK, centralized billing, and a dedicated support channel. Contact sales for a quote." },
  ];
  return (
    <Container style={{ padding: "8px 24px 80px", maxWidth: 760 }}>
      <SectionTitle style={{ textAlign: "center", marginBottom: 28 }}>Pricing questions</SectionTitle>
      <div>
        {items.map((it, i) => <FaqItem key={it.q} {...it} defaultOpen={i === 0} />)}
      </div>
      <div style={{ textAlign: "center", marginTop: 32, fontSize: 15, color: "var(--color-text-secondary)" }}>
        Still have questions? <a href="contact.html" style={{ color: "var(--color-link)", textDecoration: "none", fontWeight: 500 }}>Talk to us →</a>
      </div>
    </Container>
  );
}

Object.assign(window, { ComparisonTable, PricingFAQ });
