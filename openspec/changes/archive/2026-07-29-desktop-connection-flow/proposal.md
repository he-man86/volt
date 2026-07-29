## Why

The desktop app's connection/init flow is uncomfortable, and every symptom traces to **one mechanism**: the workspace binding is inferred by sniffing opencode's outbound `x-opencode-directory` request header (`main.ts` `watchActiveProject`). That single side-channel has two structural failure modes, plus three UX papercuts stacked on top.

**Failure mode 1 — late bind.** The header only rides on requests the GUI makes *for a project* — i.e. once a chat/session is active. A freshly-launched opencode, or a project you added but haven't opened a chat in, sends no such header, so `boundRoot` stays `undefined` and the panel is stuck on "Open a PLC project in opencode to begin" even though a project is right there. Worse: the bind can land *before* the folder is a Volt workspace, so the first thing the user sees is the init picker rather than their synced project.

**Failure mode 2 — sticky bind.** `bindWorkspace` only ever re-points on a *different* directory (`sameDir` guard). There is no request that means "no project," so once bound Volt **never releases**. Navigate opencode back to its home/project-list, or to a non-PLC project, and Volt keeps showing the last workspace's sync context as if it were live. "Detected" never clears.

The binding is the desktop's equivalent of "the open folder" — but unlike VS Code, where the open folder is a first-class, always-known signal, here it's reverse-engineered from HTTP traffic that is both **late** (chat-gated) and **one-directional** (never says "closed").

Three adjacent UX issues ride on the same surface:
- **Create-vs-connect is ambiguous.** The picker lists detected IDE projects and clicking one *creates* a workspace (folder picker). But if a workspace already exists for that project, there's no "open the existing one" — the two mental models ("make a Volt repo from this IDE project" vs "this folder already is one") collide with no signposting.
- **Folder name vs project name both show, and drift.** `repoRow` prints the folder basename; `projRow` prints the IDE project name. `init` names the folder after the project so they *start* equal, but an IDE rename (→ rebind, which does not rename the folder) splits them, and the panel shows two different names for one thing with no explanation.
- **The connect button reads "CODESYS · MyProject".** The vendor is a text prefix on the primary action. When one vendor is live it's pure noise; as an identity it belongs in a badge/icon, not the label.

## What Changes

- **Phase 1 (observation — largely done, see `observations.md`).** Verified against a live opencode server + the opencode repo: the server is **per-request directory-scoped** with **no global active-project state** to query — the `x-opencode-directory` header (stamped on *every* client request) is the sanctioned signal. One residual check remains (drive the real GUI to see whether the home screen emits a positive release signal or goes quiet); it affects only the un-bind path.
- **Bind eagerly.** Learn opencode's active project as early as opencode itself knows it — from the server API if it exposes it, falling back to the sniff — so the panel is correct without waiting for a chat.
- **Release on no-project.** When opencode reports (or the observation proves) a no-project/home state, clear the binding (debounced) so the panel stops showing stale context.
- **Separate create from open.** Give onboarding two clearly-labeled paths: "this folder is already a Volt workspace" (opencode opened it → connect) vs "create a new Volt workspace from a live IDE project" (init). Stop conflating them in one picker.
- **One identity.** Show a single workspace name (canonical: the bound project name, folder as tooltip/secondary), and when folder≠project name after a rename, say so once rather than showing two bare names.
- **Vendor as a badge, not a prefix.** Drop "CODESYS · " from the button label; render the vendor as a small badge/icon, elided when only one vendor is live.

## Non-goals

- Changing opencode itself, or adding an opencode dependency — Volt stays a config-only guest. If the server API doesn't expose the active dir, the sniff remains the fallback.
- Touching the VS Code extension's binding (its open-folder signal is already first-class and correct).
- Any change to the sync/merge engine, the connector, or the bridges.

## Capabilities

### New Capabilities
- `desktop-connection-flow`: the desktop's workspace-binding lifecycle (eager bind + release) and the connection/onboarding UX model (create-vs-open, one identity, vendor-as-badge).

## Impact

- `packages/volt-desktop/src/main.ts` (binding lifecycle — the load-bearing change), `panel.ts`, `shell.html` (renderer), `context.ts`.
- `packages/volt-control/src/view/workspace.ts` + `bridge/connector.ts` (shared onboarding/connect model — so the VS Code view stays consistent where the model is shared).
- Phase 1 resolved the mechanism: the header sniff is the signal (no server-side active-project state exists to subscribe to). The change is a self-contained rework of the sniff→bind lifecycle plus shared view-model/copy — no new opencode surface, no dependency.
