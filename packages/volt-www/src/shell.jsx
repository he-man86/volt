// Shared page shell. Imports the globals + every design component (each self-attaches to `window`) once, then each
// page in src/pages/*.jsx calls renderPage() with just its own body. Import order matters: globals first, then
// Shared/PageKit (define the Logo/Icon/Container/FaqItem helpers), then the section components.
import "./globals.js"
import "./design/Shared.jsx"
import "./design/PageKit.jsx"
import "./design/Nav.jsx"
import "./design/HeroMockup.jsx"
import "./design/Hero.jsx"
import "./design/Features.jsx"
import "./design/Architecture.jsx"
import "./design/Pricing.jsx" // Pricing, FinalCTA, Footer
import "./design/PricingPage.jsx" // ComparisonTable, PricingFAQ
import "./design/FaqPage.jsx" // FaqPage
import "./design/ContactPage.jsx" // ContactPage
import "./design/FeaturePage.jsx" // FeaturePage (reads window.__FEATURE)
import "./design/ChangelogPage.jsx" // ChangelogPage

import { createRoot } from "react-dom/client"
import "./styles.css"

// Body: a component (or () => JSX) rendering the page's content between the shared Nav and Footer.
export function renderPage(Body) {
  const { Nav, Footer } = window
  function App() {
    return (
      <>
        <Nav />
        <Body />
        <Footer />
      </>
    )
  }
  createRoot(document.getElementById("root")).render(<App />)
}
