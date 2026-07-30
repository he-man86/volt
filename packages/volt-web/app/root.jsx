// The document. In the Vite MPA this lived in 14 hand-maintained .html files, each repeating the same <head>
// and each booting its own React root; now there is one shell and the router swaps the body.
//
// Base styles first: tokens + reset + the shared primitives (.container/.btn/.card/…). Each component then
// imports its own stylesheet beside it (nav.css, hero.css, …) so those layer on top of the base.
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router"
import "./styles.css"
import { PageHeader } from "./components/ui.jsx"

// Cloudflare Web Analytics, injected only when the token is set — local builds and previews stay beacon-free.
// `import.meta.env` is inlined at build, so an unset token removes the tag entirely rather than shipping a null.
const CF_ANALYTICS_TOKEN = import.meta.env.VITE_CF_ANALYTICS_TOKEN

// Route modules that don't export their own `meta` inherit these.
export const meta = () => [
  { title: "Volt — AI for Industrial Automation" },
  {
    name: "description",
    content:
      "Everything you expect from modern AI coding tools — plus deep understanding of PLC projects, industrial automation, and engineering workflows. Beckhoff and CODESYS.",
  },
]

export function Layout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/volt-mark.svg" />
        <Meta />
        <Links />
      </head>
      <body>
        <main>{children}</main>
        <ScrollRestoration />
        <Scripts />
        {CF_ANALYTICS_TOKEN && (
          <script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={`{"token":"${CF_ANALYTICS_TOKEN}"}`}
          />
        )}
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

// Rendered inside Layout, so a 404 still gets the real nav and footer to navigate out of.
export function ErrorBoundary({ error }) {
  const is404 = isRouteErrorResponse(error) && error.status === 404
  return (
    <PageHeader
      eyebrow={is404 ? "404" : "Error"}
      title={is404 ? "Page not found" : "Something went wrong"}
      lead={
        is404
          ? "That page doesn't exist — the links above will get you back."
          : "An unexpected error occurred. Reloading usually clears it."
      }
    />
  )
}
