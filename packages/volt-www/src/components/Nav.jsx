// Top nav — cursor composition: wordmark left, centered links with dropdowns (Product / Resources), Sign in +
// Download right. Desktop dropdowns are CSS-only (hover + focus-within). Below 640px the links collapse into a
// hamburger-toggled panel (the only JS state here) so the dropdown items stay reachable on mobile.
import { useEffect, useState } from "react"
import { NAV } from "../content.js"
import { authUrl, dashboardUrl, isSignedIn } from "../config.js"
import { Logo, Button, Caret } from "./ui.jsx"
import "./nav.css"

function NavEntry({ item }) {
  if (!item.items) {
    return (
      <a href={item.href} className="nav-link">
        {item.label}
      </a>
    )
  }
  return (
    <div className="nav-item">
      <button className="nav-link nav-trigger" type="button" aria-haspopup="true">
        {item.label}
        <Caret />
      </button>
      <div className="nav-menu">
        <div className="nav-menu-panel">
          {item.items.map((sub) => (
            <a key={sub.href} href={sub.href} className="nav-menu-item">
              {sub.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

// Mobile: flatten every nav entry — groups render their label as a heading with the sub-links beneath.
function MobileMenu({ signedIn, onNavigate }) {
  return (
    <div className="nav-mobile" onClick={onNavigate}>
      {NAV.map((item) =>
        item.items ? (
          <div key={item.label} className="nav-mobile-group">
            <div className="nav-mobile-heading">{item.label}</div>
            {item.items.map((sub) => (
              <a key={sub.href} href={sub.href} className="nav-mobile-link">
                {sub.label}
              </a>
            ))}
          </div>
        ) : (
          <a key={item.label} href={item.href} className="nav-mobile-link nav-mobile-top">
            {item.label}
          </a>
        ),
      )}
      <a href={signedIn ? dashboardUrl() : authUrl()} className="nav-mobile-link nav-mobile-top">
        {signedIn ? "Dashboard" : "Sign in"}
      </a>
    </div>
  )
}

export function Nav() {
  // Resolve after mount (reads a cookie) so the pre-built HTML stays static and correct for signed-out visitors.
  const [signedIn, setSignedIn] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => setSignedIn(isSignedIn()), [])

  return (
    <header className="site-nav">
      <nav className="container container-wide site-nav-inner">
        <Logo />
        <div className="nav-links">
          {NAV.map((item) => (
            <NavEntry key={item.label} item={item} />
          ))}
        </div>
        <div className="nav-actions">
          {signedIn ? (
            <a href={dashboardUrl()} className="btn btn-secondary nav-signin">
              Dashboard
            </a>
          ) : (
            <a href={authUrl()} className="nav-link nav-signin">
              Sign in
            </a>
          )}
          <Button kind="download" variant="primary">
            Download
          </Button>
          <button
            className="nav-burger"
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className={"nav-burger-box" + (open ? " is-open" : "")}>
              <i />
              <i />
              <i />
            </span>
          </button>
        </div>
      </nav>
      {open && <MobileMenu signedIn={signedIn} onNavigate={() => setOpen(false)} />}
    </header>
  )
}
