// Shared primitives: Volt logo/mark, buttons, and the CTA href resolver (wraps config.js).
import { Link } from "react-router"
import { checkoutUrl, downloadUrl } from "../config.js"

// A route path (client-side navigation) or an off-site URL (plain anchor)? Volt's own pages are all absolute
// paths; the installer download and Polar checkout are absolute URLs.
const isInternal = (href) => href.startsWith("/")

// An <a> that routes when it can. Use for any link whose destination comes from content.js, where an entry may
// turn external later without the component knowing. A bare "#anchor" stays an anchor — same-page jumps don't
// need the router.
export function SiteLink({ href, children, ...rest }) {
  if (!isInternal(href)) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  }
  return (
    <Link to={href} {...rest}>
      {children}
    </Link>
  )
}

// CTA kinds → destination. "contact" stays on-site. `null` means the destination does not exist yet, and the
// Button renders a disabled "Coming soon" control rather than a dead link.
export function ctaHref(kind) {
  if (kind === "download") return downloadUrl()
  if (kind === "buy") return checkoutUrl()
  if (kind === "contact") return "/contact"
  return null
}

export function Button({ kind = "download", variant = "primary", size, children, href, ...rest }) {
  const cls = ["btn", `btn-${variant}`, size === "lg" && "btn-lg"].filter(Boolean).join(" ")
  const target = href ?? ctaHref(kind)

  // No destination → a non-interactive control. Keeps the layout identical to the live button.
  if (!target) {
    return (
      <span className={cls} aria-disabled="true" style={{ opacity: 0.55, cursor: "default" }} {...rest}>
        Coming soon
      </span>
    )
  }

  if (isInternal(target)) {
    return (
      <Link className={cls} to={target} {...rest}>
        {children}
      </Link>
    )
  }

  return (
    <a className={cls} href={target} {...rest}>
      {children}
    </a>
  )
}

// Volt mark: the orange bolt, no background.
function Mark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M13 2 4.5 13.2c-.5.66-.03 1.6.8 1.6H11l-1.4 7.2c-.16.85.94 1.34 1.47.66L20 11.4c.5-.66.03-1.6-.8-1.6H13.5L14.6 2.9c.14-.83-.93-1.32-1.46-.66Z"
        fill="var(--color-accent)"
      />
    </svg>
  )
}

export function Logo() {
  return (
    <Link
      to="/"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        fontWeight: 600,
        fontSize: "18px",
        letterSpacing: "-0.02em",
      }}
    >
      <Mark size={26} />
      Volt
    </Link>
  )
}

// Shared interior-page header (eyebrow + title + optional lead).
export function PageHeader({ eyebrow, title, lead }) {
  return (
    <header className="container" style={{ paddingTop: "var(--space-9)", textAlign: "center" }}>
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1 className="h2" style={{ fontSize: "var(--text-h1-size)", marginTop: "var(--space-2)" }}>
        {title}
      </h1>
      {lead && (
        <p className="lead" style={{ marginTop: "var(--space-3)", maxWidth: 600, marginInline: "auto" }}>
          {lead}
        </p>
      )}
    </header>
  )
}

export function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ marginTop: 1 }}>
      <path
        d="M4 8h8m0 0-3-3m3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Caret() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="nav-caret">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
