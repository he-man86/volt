import { For } from "solid-js"
import { createAsync, RouteSectionProps, useParams, A } from "@solidjs/router"
import { querySessionInfo } from "./common"
import "./[id].css"

// VOLT: this workspace SHELL is Volt-owned. It composes the nav/layout and renders the vendored view routes as
// `props.children` (billing / keys / members / settings / usage stay 100% opencode — the complex content is
// untouched). Rewritten from opencode's shell so it's ours to restyle, and so the earlier hacks disappear rather
// than pile up: no Zen product (Volt sells the Gateway plan), no i18n/language-switch layer (unused), no legal
// footer (legal lives on volt-www). It keeps opencode's `data-component` structure so ./[id].css still applies —
// the CSS is the redesign surface from here.
export default function WorkspaceLayout(props: RouteSectionProps) {
  const params = useParams()
  const userInfo = createAsync(() => querySessionInfo(params.id!))

  // The tab bar. `props.children` renders the selected view under it. Admin-only tabs appear when isAdmin.
  const tabs = () => [
    { path: "gateway", label: "Gateway" }, // Volt's own view; opencode's /go stays vendored + unlinked
    { path: "usage", label: "Usage" },
    { path: "keys", label: "API keys" },
    // Omitted on purpose, both still URL-reachable for the rare case (they are auth- and workspace-scoped, so
    // "not in the nav" costs nothing but a click nobody wants):
    //   • members  — team invites aren't offered yet.
    //   • settings — its only control renames the workspace, which nobody does; a whole tab for it is noise.
    ...(userInfo()?.isAdmin ? [{ path: "billing", label: "Billing" }] : []),
  ]

  const NavItems = () => (
    <div data-component="workspace-nav-items">
      <For each={tabs()}>
        {(t) => (
          <A href={`/workspace/${params.id}/${t.path}`} activeClass="active" data-nav-button>
            {t.label}
          </A>
        )}
      </For>
    </div>
  )

  // No wrapping <main data-page="workspace"> here — the parent layout (routes/workspace.tsx) already provides it
  // (with the header: logo, workspace picker, user menu + logout). This shell just adds the tab nav + content.
  return (
    <div data-component="workspace-container">
      <nav data-component="workspace-nav">
        <nav data-component="nav-desktop">
          <NavItems />
        </nav>
        <nav data-component="nav-mobile">
          <NavItems />
        </nav>
      </nav>
      <div data-component="workspace-content">
        <div data-component="workspace-main">{props.children}</div>
      </div>
    </div>
  )
}
