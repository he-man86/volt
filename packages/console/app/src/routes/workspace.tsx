import { query, createAsync, RouteSectionProps, useParams, A } from "@solidjs/router"
import "./workspace.css"
import { VoltMark } from "../component/volt-mark"
import { UserMenu } from "./user-menu"
import { withActor } from "~/context/auth.withActor"
import { User } from "@opencode-ai/console-core/user.js"
import { Actor } from "@opencode-ai/console-core/actor.js"

const getUserEmail = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    const actor = Actor.assert("user")
    const email = await User.getAuthEmail(actor.properties.userID)
    return email
  }, workspaceID)
}, "userEmail")

// VOLT: the authed shell — rendered on EVERY page behind the login, which is why its two edits matter more than
// their size. It showed opencode's mark (IconWorkspaceLogo), and its home link pointed at `/`, which now redirects
// to /auth: clicking the logo from inside a workspace bounced you out to the auth resolver and back. It goes to the
// workspace root instead, which lands on the Gateway tab. Everything else here is opencode's.
export default function WorkspaceLayout(props: RouteSectionProps) {
  const params = useParams()
  const userEmail = createAsync(() => getUserEmail(params.id!))
  return (
    <main data-page="workspace">
      <header data-component="workspace-header">
        <div data-slot="header-brand">
          <A href={`/workspace/${params.id}`} data-component="site-title">
            {/* Sized to the type, not to its own viewBox: the mark is 24×28, which towers over 18px text at full
                size. aria-hidden because the wordmark beside it already says "Volt" — a screen reader should hear
                it once, not twice. */}
            <VoltMark width="17" height="20" aria-hidden="true" />
            Volt
          </A>
          {/* VOLT: opencode's WorkspacePicker is not rendered — Volt runs one workspace per account for now, so the
              switch/create dropdown is UI complexity for a choice that isn't offered yet. The BACKEND is untouched
              (workspaces, membership, Workspace.create all still work), and routes/workspace-picker.{tsx,css} are
              left BYTE-IDENTICAL to opencode rather than deleted — so turning multi-workspace on later is just:
              re-add the import above and put `<WorkspacePicker />` back here. Kept pristine, it stays off the
              divergence gate and pulls opencode's fixes for free. */}
        </div>
        <div data-slot="header-actions">
          <UserMenu email={userEmail()} />
        </div>
      </header>
      <div>{props.children}</div>
    </main>
  )
}
