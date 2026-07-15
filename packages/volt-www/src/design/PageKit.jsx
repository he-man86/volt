// Shared building blocks for interior pages — keeps them consistent with the landing page.
const Container = ({ children, style }) => (
  <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 24px", ...style }}>{children}</div>
);

function PageHero({ eyebrow, title, subtitle, children }) {
  return (
    <section style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-background)" }}>
      <Container style={{ padding: "72px 24px 56px", textAlign: "center" }}>
        {eyebrow && <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent)", letterSpacing: ".02em" }}>{eyebrow}</div>}
        <h1 style={{ fontSize: 46, lineHeight: "52px", fontWeight: 600, letterSpacing: "-0.03em", margin: "12px auto 0", maxWidth: 720, color: "var(--color-text-primary)", textWrap: "balance" }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 18, lineHeight: "28px", color: "var(--color-text-secondary)", margin: "16px auto 0", maxWidth: 560, textWrap: "pretty" }}>{subtitle}</p>}
        {children && <div style={{ marginTop: 28, display: "flex", gap: 12, justifyContent: "center" }}>{children}</div>}
      </Container>
    </section>
  );
}

// Section heading used inside content pages
const SectionTitle = ({ children, style }) => (
  <h2 style={{ fontSize: 28, lineHeight: "36px", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-text-primary)", margin: 0, ...style }}>{children}</h2>
);

// Accordion item — used by FAQ page and pricing FAQ
function FaqItem({ q, a, defaultOpen }) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid var(--color-border)" }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
        background: "none", border: "none", cursor: "pointer", padding: "20px 0", textAlign: "left", fontFamily: "inherit",
      }}>
        <span style={{ fontSize: 16.5, fontWeight: 500, color: "var(--color-text-primary)" }}>{q}</span>
        <span style={{ flexShrink: 0, color: "var(--color-text-secondary)", transform: open ? "rotate(45deg)" : "none", transition: "transform 160ms ease" }}>
          <Icon d={["M12 5v14", "M5 12h14"]} size={18} stroke="var(--color-text-secondary)" />
        </span>
      </button>
      <div style={{ maxHeight: open ? 240 : 0, overflow: "hidden", transition: "max-height 220ms ease" }}>
        <p style={{ fontSize: 15, lineHeight: "24px", color: "var(--color-text-secondary)", margin: "0 0 22px", maxWidth: 680, textWrap: "pretty" }}>{a}</p>
      </div>
    </div>
  );
}

Object.assign(window, { Container, PageHero, SectionTitle, FaqItem });
