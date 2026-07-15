// Changelog — release timeline with version, date, tag, and notes.
const RELEASES = [
  {
    v: "0.9.0", date: "Jun 24, 2026", tag: "Latest", tagVariant: "accent",
    title: "Two-way sync goes GA",
    notes: [
      { t: "new", c: "Automatic two-way sync between the local repository and Beckhoff / CODESYS is now generally available." },
      { t: "new", c: "Conflict resolution UI when the IDE and repository diverge." },
      { t: "improved", c: "Project mirroring is ~40% faster on large solutions." },
      { t: "fixed", c: "Structured Text formatter no longer reorders pragma comments." },
    ],
  },
  {
    v: "0.8.2", date: "Jun 10, 2026",
    title: "Testing & CI improvements",
    notes: [
      { t: "new", c: "bun test integration with function-block test scaffolding." },
      { t: "new", c: "Example GitHub Actions workflow for mirrored projects." },
      { t: "fixed", c: "VS Code extension reconnects cleanly after sleep." },
    ],
  },
  {
    v: "0.8.0", date: "May 28, 2026",
    title: "PLC-aware language server",
    notes: [
      { t: "new", c: "Go-to-definition and find-references across the whole PLC project." },
      { t: "new", c: "Dependency graph generation from the project mirror." },
      { t: "improved", c: "AI now cites the function blocks and safety chains it reasons over." },
    ],
  },
  {
    v: "0.7.0", date: "May 12, 2026",
    title: "CLI + VS Code surface",
    notes: [
      { t: "new", c: "volt CLI with connect, sync, and test commands." },
      { t: "new", c: "VS Code extension for terminal-first workflows." },
    ],
  },
];

const TAGS = {
  new: { label: "New", bg: "rgba(217,119,6,0.10)", color: "var(--color-accent-hover)" },
  improved: { label: "Improved", bg: "rgba(13,13,13,0.06)", color: "var(--color-text-primary)" },
  fixed: { label: "Fixed", bg: "rgba(22,163,68,0.10)", color: "var(--color-success)" },
};

function NoteTag({ t }) {
  const s = TAGS[t] || TAGS.improved;
  return <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: s.bg, color: s.color, fontFamily: "var(--font-mono)" }}>{s.label}</span>;
}

function ChangelogPage() {
  const { Badge } = window.VoltDesignSystem_704691;
  return (
    <React.Fragment>
      <PageHero eyebrow="Changelog" title="What's new in Volt" subtitle="Product updates, improvements, and fixes — shipped continuously." />
      <Container style={{ padding: "56px 24px 80px", maxWidth: 820 }}>
        {RELEASES.map((r, i) => (
          <div key={r.v} style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 32 }}>
            {/* left rail */}
            <div style={{ position: "sticky", top: 84, alignSelf: "start", paddingBottom: 48 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18, fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--color-text-primary)" }}>v{r.v}</span>
                {r.tag && <Badge variant={r.tagVariant || "neutral"}>{r.tag}</Badge>}
              </div>
              <div style={{ fontSize: 13.5, color: "var(--color-text-secondary)", marginTop: 4 }}>{r.date}</div>
            </div>
            {/* timeline + content */}
            <div style={{ position: "relative", paddingLeft: 28, paddingBottom: 48, borderLeft: i === RELEASES.length - 1 ? "1px solid transparent" : "1px solid var(--color-border)" }}>
              <span style={{ position: "absolute", left: -6.5, top: 4, width: 12, height: 12, borderRadius: 999, background: i === 0 ? "var(--color-accent)" : "var(--color-background)", border: "2px solid " + (i === 0 ? "var(--color-accent)" : "var(--color-border)") }} />
              <h2 style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--color-text-primary)", margin: "-2px 0 16px" }}>{r.title}</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {r.notes.map((n, j) => (
                  <div key={j} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <NoteTag t={n.t} />
                    <span style={{ fontSize: 15, lineHeight: "23px", color: "var(--color-text-secondary)", textWrap: "pretty" }}>{n.c}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
        <div style={{ textAlign: "center", fontSize: 14, color: "var(--color-text-secondary)", marginTop: 8 }}>
          Looking for older releases? <a href="faq.html" style={{ color: "var(--color-link)", textDecoration: "none", fontWeight: 500 }}>Check the FAQ →</a>
        </div>
      </Container>
    </React.Fragment>
  );
}

window.ChangelogPage = ChangelogPage;
