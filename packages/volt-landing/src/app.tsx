import { MetaProvider, Title, Meta } from "@solidjs/meta"
import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Suspense } from "solid-js"

// ponytail: minimal shell — no i18n/language providers (console/app has them; volt-landing
// doesn't need them yet). Add branding/fonts when the landing design lands (commercial-landing).
export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <Title>Volt — version control for PLC code</Title>
          <Meta name="description" content="Manage CODESYS and TwinCAT projects as version-controllable text." />
          <Suspense>{props.children}</Suspense>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  )
}
