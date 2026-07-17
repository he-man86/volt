import { MetaProvider, Title, Meta } from "@solidjs/meta"
import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Suspense } from "solid-js"
import { Favicon } from "./ui"
// VOLT: Volt's brand faces, self-hosted (no CDN) — the same two volt-www uses, so the console and the site read as
// one product. Imported from TS, not via `@import` in volt-theme.css: vite does not pull a bare CSS @import
// specifier into the bundle, so the @font-face rules silently never shipped and the whole font port was inert.
// This is opencode's own pattern for @ibm/plex, which is why theirs worked and mine didn't.
//
// opencode's `import "@ibm/plex/css/ibm-plex.css"` is DROPPED with it: their token/font.css aliases --font-sans to
// --font-mono (the console was monospace end-to-end), and volt-theme.css now overrides both, so nothing references
// IBM Plex any more — it was shipping ~437 unused @font-face rules and their woff2 payloads to every visitor.
import "@fontsource-variable/inter"
import "@fontsource-variable/jetbrains-mono"
import "./app.css"
import "./style/volt-theme.css" // VOLT: brand theme override — loaded after ./app.css so it wins (see the file)
import "./style/volt-components.css" // VOLT: the few component SHAPES no token can express (see the file)
import { LanguageProvider } from "~/context/language"
import { I18nProvider, useI18n } from "~/context/i18n"
import { strip } from "~/lib/language"

function AppMeta() {
  const i18n = useI18n()
  return (
    <>
      <Title>Volt</Title>{/* VOLT: browser tab title (was "opencode") */}
      <Meta name="description" content={i18n.t("app.meta.description")} />
      <Favicon />
    </>
  )
}

export default function App() {
  return (
    <Router
      explicitLinks={true}
      transformUrl={strip}
      root={(props) => (
        <LanguageProvider>
          <I18nProvider>
            <MetaProvider>
              <AppMeta />
              <Suspense>{props.children}</Suspense>
            </MetaProvider>
          </I18nProvider>
        </LanguageProvider>
      )}
    >
      <FileRoutes />
    </Router>
  )
}
