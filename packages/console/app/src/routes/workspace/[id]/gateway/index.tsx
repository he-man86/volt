import { createAsync, useParams, A } from "@solidjs/router"
import { Show } from "solid-js"
import { GoReferralSection, queryGoReferral } from "~/component/go-referral"
import { useI18n } from "~/context/i18n"
import { LiteSection, queryLiteSubscription } from "../go/lite-section"
import "./gateway.css"

// VOLT: the Gateway tab — Volt-owned, and the workspace home. It replaces opencode's /go view rather than patching
// it: the /go route stays on disk byte-identical to opencode (dormant, unlinked), so its subscription logic keeps
// merging conflict-free on a bump while Volt's copy lives here. The heavy sections are IMPORTED from it, not
// copied — only the header + quick-connect below are ours.
export default function () {
  const params = useParams()
  const i18n = useI18n()
  const referral = createAsync(() => queryGoReferral(params.id!))
  const lite = createAsync(() => queryLiteSubscription(params.id!))

  return (
    <div data-page="workspace-[id]" data-volt="gateway">
      <section data-component="header-section">
        <h1>Volt Gateway</h1>
        <p>
          <span>One subscription for the models the Volt agent runs on. No provider accounts, no BYOK.</span>
        </p>
      </section>

      <div data-slot="sections">
        <LiteSection lite={lite()} />

        <section data-volt-slot="quick-connect">
          <h2>Quick connect</h2>
          <ol>
            <li>
              Create a key on the <A href={`/workspace/${params.id}/keys`}>API keys</A> tab.
            </li>
            <li>
              Run <code>opencode auth login</code>, pick <strong>Volt AI</strong>, and paste the key.
            </li>
            <li>
              Pick a <strong>(Volt)</strong> model in the agent — Volt ships the provider, so there is nothing to
              configure.
            </li>
          </ol>
        </section>

        <Show when={referral()} fallback={<section>{i18n.t("workspace.lite.loading")}</section>}>
          {(summary) => <GoReferralSection workspaceID={params.id!} summary={summary()} lite={lite()} />}
        </Show>
      </div>
    </div>
  )
}
