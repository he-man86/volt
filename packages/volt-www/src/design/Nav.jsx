// Top navigation — calm, with elegant text dropdowns
const PRODUCT_MENU = [
  { label: "Understand every PLC project", href: "feature-project-understanding.html", desc: "AI that sees whole projects" },
  { label: "AI-Native PLC Languages", href: "feature-ai-native-plc-languages.html", desc: "Graphical logic, readable by AI" },
  { label: "Modern engineering workflows", href: "feature-modern-engineering-workflows.html", desc: "Docs, Git, and testing" },
  { label: "Volt-git", href: "feature-volt-git.html", desc: "The engineering bridge" },
  { label: "Compiler Intelligence", href: "feature-compiler-intelligence.html", desc: "Validation before sync" },
  { label: "Engineering with confidence", href: "feature-engineering-with-confidence.html", desc: "Understandable, predictable AI" },
  { label: "Privacy & enterprise", href: "feature-privacy-and-enterprise.html", desc: "Your projects, your control" },
  { label: "Desktop + CLI", href: "feature-desktop-and-cli.html", desc: "Two experiences, one platform" },
];

const RESOURCES_MENU = [
  { label: "FAQ", href: "faq.html" },
  { label: "Changelog", href: "changelog.html" },
  { label: "Contact", href: "contact.html" },
];

function MenuRow({ label, href, desc }) {
  const [h, setH] = React.useState(false);
  return (
    <a href={href} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
       style={{ display: "block", padding: "10px 20px", textDecoration: "none", whiteSpace: "nowrap",
         background: h ? "var(--color-surface)" : "transparent", transition: "background 120ms ease" }}>
      <div style={{ fontSize: 14.5, fontWeight: 500, color: "var(--color-text-primary)" }}>{label}</div>
      {desc && <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginTop: 2 }}>{desc}</div>}
    </a>
  );
}

function NavDropdown({ label, items }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} style={{ position: "relative" }}>
      <button style={{
        display: "inline-flex", alignItems: "center", gap: 5, border: "none", background: "none", cursor: "pointer", padding: "20px 0",
        fontSize: 14, fontWeight: 450, fontFamily: "inherit", color: open ? "var(--color-text-primary)" : "var(--color-text-secondary)", transition: "color 120ms ease",
      }}>
        {label}
      </button>
      <div style={{
        position: "absolute", top: "calc(100% - 8px)", left: -20, opacity: open ? 1 : 0, visibility: open ? "visible" : "hidden",
        transform: open ? "translateY(0)" : "translateY(-4px)", transition: "opacity 140ms ease, transform 140ms ease, visibility 140ms",
        background: "var(--color-background)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "var(--shadow-md)",
        padding: "8px 0", minWidth: 220,
      }}>
        {items.map((it) => <MenuRow key={it.label} {...it} />)}
      </div>
    </div>
  );
}

function Nav() {
  const { Button } = window.VoltDesignSystem_704691;
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 50,
      background: "rgba(247,246,243,0.8)", backdropFilter: "blur(12px)",
      borderBottom: "1px solid var(--color-border)",
    }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 24px", height: 60, display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <a href="index.html" style={{ textDecoration: "none", display: "inline-flex" }}>
            <Logo markColor="rgb(180, 83, 9)" />
          </a>
        </div>
        <nav style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 26 }}>
          <NavDropdown label="Product" items={PRODUCT_MENU} />
          <a href="pricing.html" style={{ fontSize: 14, color: "var(--color-text-secondary)", textDecoration: "none", fontWeight: 450, padding: "20px 0" }}
             onMouseEnter={(e) => e.currentTarget.style.color = "var(--color-text-primary)"}
             onMouseLeave={(e) => e.currentTarget.style.color = "var(--color-text-secondary)"}>Pricing</a>
          <NavDropdown label="Resources" items={RESOURCES_MENU} />
        </nav>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          {/* volt: wired to the console — /auth (OpenAuth) + the OS-detected download resolver */}
          <a href={window.VOLT.authUrl()} style={{ textDecoration: "none", display: "inline-flex" }}><Button variant="ghost" size="sm">Sign in</Button></a>
          <a href={window.VOLT.downloadUrl()} style={{ textDecoration: "none", display: "inline-flex" }}>
            <Button variant="secondary" size="sm">
              <Icon d={["M12 3v11", "M8 10l4 4 4-4", "M5 20h14"]} size={15} stroke="var(--color-text-on-dark)" />
              Download
            </Button>
          </a>
        </div>
      </div>
    </header>
  );
}
window.Nav = Nav;
