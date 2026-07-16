// Top nav — cursor composition: wordmark left, centered links with dropdowns (Product / Resources), Sign in +
// Download right. Dropdowns are CSS-only (hover + focus-within), so no JS/menu library.
import { useEffect, useState } from "react"
import { NAV } from "../content.js"
import { authUrl, dashboardUrl, isSignedIn } from "../config.js"
import { Logo, Button, Caret } from "./ui.jsx"

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

export function Nav() {
  // Resolve after mount (reads a cookie) so the pre-built HTML stays static and correct for signed-out visitors.
  const [signedIn, setSignedIn] = useState(false)
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
            <a href={dashboardUrl()} className="btn btn-secondary">
              Dashboard
            </a>
          ) : (
            <a href={authUrl()} className="nav-link">
              Sign in
            </a>
          )}
          <Button kind="download" variant="primary">
            Download
          </Button>
        </div>
      </nav>
    </header>
  )
}
