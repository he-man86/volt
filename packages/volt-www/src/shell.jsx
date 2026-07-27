// Page shell: Nav + page body + Footer. Each src/pages/*.jsx calls renderPage(<body/>).
import { createRoot } from "react-dom/client"
// Base first: tokens + reset + the shared primitives (.container/.btn/.card/…). Each component then imports its
// own stylesheet beside it (nav.css, hero.css, …), the same way the mockups do, so they layer on top of the base.
import "./styles.css"
import { Nav } from "./components/Nav.jsx"
import { Footer } from "./components/Footer.jsx"

export function renderPage(body) {
  createRoot(document.getElementById("root")).render(
    <>
      <Nav />
      <main>{body}</main>
      <Footer />
    </>,
  )
}
