import { MetaProvider, Title, Meta } from "@solidjs/meta"
import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Suspense } from "solid-js"
import { Favicon } from "./ui"
import "@ibm/plex/css/ibm-plex.css"
import "./app.css"
import "./style/volt-theme.css" // VOLT: brand theme override — loaded after ./app.css so it wins (see the file)
import { LanguageProvider } from "~/context/language"
import { I18nProvider, useI18n } from "~/context/i18n"
import { strip } from "~/lib/language"

function AppMeta() {
  const i18n = useI18n()
  return (
    <>
      <Title>opencode</Title>
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
