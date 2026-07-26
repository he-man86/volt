// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server"
import { getRequestEvent } from "solid-js/web"
import { dir, localeFromRequest, tag } from "~/lib/language"

const criticalCSS = `[data-component="top"]{min-height:80px;display:flex;align-items:center}`

export default createHandler(
  () => (
    <StartServer
      document={({ assets, children, scripts }) => {
        const evt = getRequestEvent()
        const locale = evt ? localeFromRequest(evt.request) : "en"

        return (
          <html lang={tag(locale)} dir={dir(locale)} data-locale={locale}>
            <head>
              <meta charset="utf-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <meta property="og:image" content="/web-app-manifest-512x512.png" />
              <meta property="twitter:image" content="/web-app-manifest-512x512.png" />
              <style>{criticalCSS}</style>
              {assets}
            </head>
            <body>
              <div id="app">{children}</div>
              {scripts}
              {/* VOLT: Cloudflare Web Analytics. Additive one-liner — the shell is a framework entry point that a
                  beside-file can't shadow. Manual snippet is mandatory: the console is a Worker, and Cloudflare's
                  automatic injection only rewrites origin responses. Same zone-level token as www; the dashboard
                  splits the two by hostname. Token is public by design. */}
              <script
                defer
                src="https://static.cloudflareinsights.com/beacon.min.js"
                data-cf-beacon='{"token": "1107c69783d94f4aa88ce03e88ebf752"}'
              />
            </body>
          </html>
        )
      }}
    />
  ),
  {
    mode: "async",
  },
)
