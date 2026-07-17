import "./[...404].css"
import { Title } from "@solidjs/meta"
import { HttpStatusCode } from "@solidjs/start"
import { VoltMark } from "~/component/volt-mark"

// VOLT: the app's only catch-all, and Volt-owned rather than patched.
//
// opencode's version was a marketing 404: its ornate wordmark, `"Not Found | opencode"`, a link to
// github.com/anomalyco/opencode, and links to `/docs` and `/discord` — two routes the public-surface strip deleted,
// so the 404 page 404'd onto itself. Every mistyped URL on Volt's console handed the user opencode's brand and
// three dead ends.
//
// The console is the account app, so there is exactly one useful action: get back to your workspace. `/auth`
// resolves to the last workspace or the login screen, so it is correct for a signed-in and a signed-out visitor
// alike. Volt's public site is a separate package (volt-www) and is deliberately not linked from here — this page
// is only ever reached from inside the app.
export default function NotFound() {
  return (
    <main data-page="not-found">
      <Title>Page not found — Volt</Title>
      <HttpStatusCode code={404} />
      <div data-component="content">
        <section data-component="top">
          {/* Inline so it inherits the page colour — one mark reads in light and dark, no light/dark pair. */}
          <VoltMark data-slot="logo" width="48" height="56" aria-label="Volt" />
          <h1 data-slot="title">Page not found</h1>
        </section>

        <section data-component="actions">
          <div data-slot="action">
            <a href="/auth">Go to your workspace</a>
          </div>
        </section>
      </div>
    </main>
  )
}
