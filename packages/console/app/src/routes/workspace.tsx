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
            <VoltMark />
          </A>
          {/* VOLT: opencode's WorkspacePicker is gone from the header. Volt is a one-workspace product, so a
              dropdown to switch between workspaces offers a choice that never exists — and the same control was
              also the only UI that CREATED more of them, which is worse than noise. Onboarding is unaffected:
              function/src/auth.ts:239 creates the "Default" workspace at signup, not this picker. */}
        </div>
        <div data-slot="header-actions">
          <UserMenu email={userEmail()} />
        </div>
      </header>
      <div>{props.children}</div>
    </main>
  )
}
