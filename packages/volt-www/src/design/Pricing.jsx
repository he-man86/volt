function Pricing() {
  const { Button } = window.VoltDesignSystem_704691;
  const plans = [
    { name: "Free", price: "€0", note: "For evaluation and personal projects.", cta: "Start Free", variant: "outline", feats: ["Bring your own AI provider", "Core functionality", "Beckhoff & CODESYS", "Desktop + CLI", "Project synchronization", "Community support"] },
    { name: "Pro", price: "€24", per: "/mo", note: "For professional automation engineers.", cta: "Start Free", variant: "primary", featured: true, feats: ["Hosted AI included", "Higher usage limits", "Advanced project analysis", "Documentation generation", "Priority model access"] },
    { name: "Enterprise", price: "Custom", note: "For teams and industrial organizations.", cta: "Contact Sales", variant: "secondary", feats: ["SSO & team management", "Audit logs", "BYOK", "Centralized billing", "Private deployment", "Dedicated support"] },
  ];
  return (
    <section style={{ maxWidth: 1120, margin: "0 auto", padding: "80px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 44 }}>
        <h2 style={{ fontSize: 36, lineHeight: "44px", fontWeight: 600, letterSpacing: "-0.02em", margin: 0, color: "var(--color-text-primary)" }}>Simple, transparent pricing</h2>
        <p style={{ fontSize: 16, color: "var(--color-text-secondary)", margin: "12px 0 0" }}>Start free. Upgrade when your projects do.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {plans.map((p) => (
          <div key={p.name} style={{
            background: p.featured ? "#fff" : "var(--color-surface)",
            border: p.featured ? "1.5px solid var(--color-accent)" : "1px solid var(--color-border)",
            borderRadius: 16, padding: 24, display: "flex", flexDirection: "column",
            boxShadow: p.featured ? "var(--shadow-md)" : "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>{p.name}</span>
              {p.featured && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-accent-hover)", background: "rgba(217,119,6,0.12)", padding: "3px 8px", borderRadius: 999 }}>Popular</span>}
            </div>
            <div style={{ margin: "14px 0 4px", display: "flex", alignItems: "baseline", gap: 3 }}>
              <span style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-text-primary)" }}>{p.price}</span>
              {p.per && <span style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>{p.per}</span>}
            </div>
            <p style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)", margin: "0 0 16px", minHeight: 38 }}>{p.note}</p>
            {/* volt: Start Free → console /auth; Contact Sales → contact page */}
            <a href={p.cta === "Contact Sales" ? "contact.html" : window.VOLT.authUrl()} style={{ textDecoration: "none", display: "block" }}>
              <Button variant={p.variant} style={{ width: "100%" }}>{p.cta}</Button>
            </a>
            <div style={{ borderTop: "1px solid var(--color-border)", margin: "20px 0 14px" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {p.feats.map((f) => (
                <div key={f} style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: "18px", color: "var(--color-text-secondary)" }}>
                  <Icon d={ICONS.check} size={15} stroke="var(--color-success)" />{f}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalCTA() {
  const { Button } = window.VoltDesignSystem_704691;
  return (
    <section style={{ maxWidth: 1120, margin: "0 auto", padding: "40px 24px 96px" }}>
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 20, padding: "64px 32px", textAlign: "center" }}>
        <VoltMark size={32} color="var(--color-accent)" />
        <h2 style={{ fontSize: 38, lineHeight: "46px", fontWeight: 600, letterSpacing: "-0.025em", margin: "20px auto 0", maxWidth: 560, color: "var(--color-text-primary)", textWrap: "balance" }}>
          Bring modern engineering workflows to your PLC projects
        </h2>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 28 }}>
          {/* volt: Start Free → console /auth; View Demo scrolls to the interactive hero mockup (#demo) */}
          <a href={window.VOLT.authUrl()} style={{ textDecoration: "none", display: "inline-flex" }}>
            <Button variant="primary" size="lg">Start Free</Button>
          </a>
          <a href="#demo" style={{ textDecoration: "none", display: "inline-flex" }}>
            <Button variant="outline" size="lg">View Demo</Button>
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const cols = {
    Product: [{ l: "Desktop app", h: "index.html#desktop" }, { l: "CLI + VS Code", h: "index.html#cli" }, { l: "Pricing", h: "pricing.html" }, { l: "Changelog", h: "changelog.html" }],
    Platforms: [{ l: "Beckhoff", h: "index.html#platforms" }, { l: "CODESYS", h: "index.html#platforms" }, { l: "AI-Native PLC Languages", h: "index.html#ai-native" }, { l: "Roadmap", h: "index.html#platforms" }],
    Company: [{ l: "About", h: "contact.html" }, { l: "Blog", h: "changelog.html" }, { l: "Careers", h: "contact.html" }, { l: "Contact", h: "contact.html" }],
    Resources: [{ l: "FAQ", h: "faq.html" }, { l: "Changelog", h: "changelog.html" }, { l: "Contact", h: "contact.html" }, { l: "Status", h: "changelog.html" }],
  };
  return (
    <footer style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-background)" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "48px 24px", display: "grid", gridTemplateColumns: "1.4fr repeat(4, 1fr)", gap: 32 }}>
        <div>
          <Logo />
          <p style={{ fontSize: 13, lineHeight: "20px", color: "var(--color-text-secondary)", margin: "14px 0 0", maxWidth: 220 }}>
            The AI development platform for industrial automation.
          </p>
        </div>
        {Object.entries(cols).map(([h, links]) => (
          <div key={h}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 12 }}>{h}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {links.map((l) => (
                <a key={l.l} href={l.h} style={{ fontSize: 13, color: "var(--color-text-secondary)", textDecoration: "none" }}
                   onMouseEnter={(e) => e.currentTarget.style.color = "var(--color-text-primary)"}
                   onMouseLeave={(e) => e.currentTarget.style.color = "var(--color-text-secondary)"}>{l.l}</a>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 24px 40px", fontSize: 12.5, color: "var(--color-text-secondary)", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
        <span>© 2026 Volt. All rights reserved.</span>
        {[{ l: "Terms", h: "legal/terms.html" }, { l: "Privacy", h: "legal/privacy.html" }, { l: "Cookies", h: "legal/cookies.html" }].map((l) => (
          <a key={l.l} href={l.h} style={{ color: "var(--color-text-secondary)", textDecoration: "none" }}
             onMouseEnter={(e) => e.currentTarget.style.color = "var(--color-text-primary)"}
             onMouseLeave={(e) => e.currentTarget.style.color = "var(--color-text-secondary)"}>{l.l}</a>
        ))}
      </div>
    </footer>
  );
}

Object.assign(window, { Pricing, FinalCTA, Footer });
