// Page shell: Nav + page body + Footer. Each src/pages/*.jsx calls renderPage(<body/>).
import { createRoot } from "react-dom/client"
import { Nav } from "./components/Nav.jsx"
import { Footer } from "./components/Footer.jsx"
import "./styles.css"

export function renderPage(body) {
  createRoot(document.getElementById("root")).render(
    <>
      <Nav />
      <main>{body}</main>
      <Footer />
    </>,
  )
}
