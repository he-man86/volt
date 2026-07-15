// FAQ page — grouped questions using the shared accordion.
const FAQ_GROUPS = [
  {
    title: "Product",
    items: [
      { q: "What is Volt, in one sentence?", a: "Volt is the AI development platform for industrial automation — it mirrors complete PLC projects into a local repository so AI understands whole systems, not isolated files." },
      { q: "How is this different from a generic AI coding assistant?", a: "Generic tools see snippets through a thin bridge. Volt mirrors the entire project locally with a PLC-aware language server, full dependency analysis, testing, Git, and safe refactoring across the whole codebase." },
      { q: "Is industrial automation the only thing Volt does?", a: "No. Every mirrored project becomes a standard Bun repository, so Volt is equally at home with TypeScript, Python, and modern dev workflows. Automation is a superpower added on top." },
    ],
  },
  {
    title: "Platforms & compatibility",
    items: [
      { q: "Which PLC platforms are supported?", a: "Beckhoff and CODESYS are supported today. Siemens, Rockwell, Schneider, and Omron are on the roadmap and included in every plan when released." },
      { q: "Do I have to leave my existing IDE?", a: "No. Volt works alongside your PLC IDE. Changes sync back automatically, so you keep the tools your team already relies on." },
      { q: "Which operating systems does Volt run on?", a: "The desktop app and CLI run on Windows and Linux, and integrate with VS Code." },
    ],
  },
  {
    title: "AI & data",
    items: [
      { q: "Can I use my own AI provider?", a: "Yes. On the Free plan you connect your own API key. Pro, Max, and Enterprise include hosted AI with higher limits and premium models." },
      { q: "Does my code leave my machine?", a: "Editing, language tooling, Git, and tests all run against the local repository. Only the context you send to AI reaches your chosen provider — and Enterprise supports BYOK for full control." },
      { q: "Does Volt work offline?", a: "Yes, for everything except AI requests, which need connectivity to your provider." },
    ],
  },
  {
    title: "Billing",
    items: [
      { q: "Is there a free plan?", a: "Yes — Free includes core functionality, Beckhoff & CODESYS support, desktop + CLI, and project sync, using your own AI provider." },
      { q: "Can I change plans anytime?", a: "Yes. Plans are month-to-month with no lock-in. Upgrades apply immediately; downgrades take effect at the end of the cycle." },
      { q: "How does Enterprise pricing work?", a: "Enterprise is priced per organization based on seats and deployment, adding SSO, audit logs, BYOK, and dedicated support. Contact sales for a quote." },
    ],
  },
];

function FaqPage() {
  const { Button } = window.VoltDesignSystem_704691;
  return (
    <React.Fragment>
      <PageHero eyebrow="FAQ" title="Frequently asked questions" subtitle="Answers about how Volt works, what it supports, and how it's priced." />
      <Container style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 56, padding: "56px 24px 72px", alignItems: "start" }}>
        <aside style={{ position: "sticky", top: 84, alignSelf: "start" }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--color-text-secondary)", marginBottom: 10 }}>Categories</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {FAQ_GROUPS.map((g) => (
              <a key={g.title} href={"#" + g.title.toLowerCase().replace(/[^a-z]+/g, "-")} style={{ fontSize: 14.5, padding: "6px 0", textDecoration: "none", color: "var(--color-text-secondary)" }}
                 onMouseEnter={(e) => e.currentTarget.style.color = "var(--color-text-primary)"}
                 onMouseLeave={(e) => e.currentTarget.style.color = "var(--color-text-secondary)"}>{g.title}</a>
            ))}
          </div>
        </aside>
        <div>
          {FAQ_GROUPS.map((g) => (
            <div key={g.title} id={g.title.toLowerCase().replace(/[^a-z]+/g, "-")} style={{ marginBottom: 44, scrollMarginTop: 84 }}>
              <SectionTitle style={{ fontSize: 22, marginBottom: 4 }}>{g.title}</SectionTitle>
              <div>
                {g.items.map((it) => <FaqItem key={it.q} {...it} />)}
              </div>
            </div>
          ))}
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 14, padding: "24px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-text-primary)" }}>Still have a question?</div>
              <div style={{ fontSize: 14, color: "var(--color-text-secondary)", marginTop: 4 }}>Reach the team directly — we usually reply within a day.</div>
            </div>
            <a href="contact.html" style={{ textDecoration: "none" }}><Button variant="primary">Contact us</Button></a>
          </div>
        </div>
      </Container>
    </React.Fragment>
  );
}

window.FaqPage = FaqPage;
