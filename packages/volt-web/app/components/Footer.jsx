import { FOOTER } from "../content.js"
import { Logo, SiteLink } from "./ui.jsx"
import "./footer.css"

export function Footer() {
  return (
    <footer style={{ borderTop: "1px solid var(--color-border)", marginTop: "var(--space-10)" }}>
      <div
        className="container container-wide"
        style={{
          display: "grid",
          gridTemplateColumns: "1.5fr repeat(3, 1fr)",
          gap: "var(--space-6)",
          paddingBlock: "var(--space-8)",
        }}
        data-footer-grid
      >
        <div>
          <Logo />
          <p
            className="muted"
            style={{ marginTop: "var(--space-3)", fontSize: "var(--text-small-size)", maxWidth: 260 }}
          >
            The AI coding agent for industrial automation. CODESYS and TwinCAT.
          </p>
        </div>
        {FOOTER.columns.map((col) => (
          <div key={col.title}>
            <div className="eyebrow" style={{ marginBottom: "var(--space-3)" }}>
              {col.title}
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-2)" }}>
              {col.links.map((l) => (
                <li key={l.href}>
                  <SiteLink href={l.href} className="muted" style={{ fontSize: "var(--text-small-size)" }}>
                    {l.label}
                  </SiteLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div
        className="container container-wide"
        style={{
          borderTop: "1px solid var(--color-border-faint)",
          paddingBlock: "var(--space-5)",
          fontSize: "var(--text-caption-size)",
          color: "var(--text-muted)",
        }}
      >
        © {new Date().getFullYear()} Volt. Not affiliated with any PLC vendor.
      </div>
    </footer>
  )
}
