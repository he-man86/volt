# Observations — how opencode reports the active directory

Verified against the installed opencode binary (winget, 2026-07-16 build) — live-probed a running `opencode serve`, cross-checked against the opencode repo (`anomalyco/opencode`, formerly `sst/opencode`) and docs.

## What the server actually exposes

The opencode server has **no global "which project is the GUI viewing" state.** Every request is **directory-scoped** by the `x-opencode-directory` request header (URL-encoded path) or a `?directory=` query param — a Hono middleware resolves the project from that per request. Confirmed live:

- `GET /project/current` with **no** directory header → `{"id":"global","worktree":"/",…}` — i.e. the fallback "global" project, **not** whatever the GUI is looking at.
- `GET /project/current` with a header pointing at a non-repo dir → still `global`.
- `GET /project` → a flat **registry** of every project opencode has ever opened (worktree paths), not a "current" pointer.
- `GET /session` → sessions each carry their own `directory` + `projectID`, but it's a list, not a current pointer.
- `GET /event` (SSE) → idle emits only `server.connected`; real events (`project.directories.updated`, `session.*`, `file.watcher.updated`) fire **only on activity**.

The web client (served from `/app`) uses a `createOpencodeClient()` **fetch interceptor that stamps `x-opencode-directory` on every request** based on its currently-selected directory. So the directory the GUI is on is a **client-side** notion, surfaced to the server (and to us) only *through the header on the requests the GUI happens to make*.

## Consequences for the plan

**"Case A" (query/subscribe to the server for the active dir) is not achievable** — there is no server-side active-project signal to query. `/project/current` needs the directory passed *in*; it can't tell us what the GUI selected. The `x-opencode-directory` header sniff (current mechanism) is in fact the **sanctioned, most-direct** read of the GUI's selected directory. So the design collapses to the sniff — but now with a *known* structure instead of a guess:

1. **Late-bind fix is real and simple.** The header is on *every* client request, not just chat traffic — browsing into a project fetches its sessions/config/events, all header-stamped. So **bind on any request that resolves to a real project directory**, not only the ones a chat generates. That removes the "must open a chat first" wait.

2. **No-project signal = the `global` / directory-less case.** When the GUI is on its home / project-list, its selected directory is empty or the `global` project (`worktree: "/"`). A request that resolves to `global` (or carries no `x-opencode-directory`) is the positive "no project selected" signal → **release the binding** (debounced). This is what the current code lacks entirely.

## The one residual unknown (the narrow remaining spike)

Confirmed by curl, but **not yet by driving the real GUI**: when the user navigates opencode *to* its home screen, does the client keep making (directory-less / global) requests we can observe — a *positive* un-bind signal — or does it simply **go quiet** (no requests at all)?

- If it emits directory-less requests → release on that signal (clean).
- If it goes quiet → there is no positive "left the project" event; fall back to releasing when a home-screen navigation is otherwise detectable, or accept an idle-timeout release. This is the only branch left to settle, and it only affects the un-bind path, not the eager-bind path.

Task 1.1 is now exactly this one observation (instrument the sniff, watch the home transition), not a broad spike.

---

## VERIFIED against the live GUI (2026-07 build) — task 1.1 CLOSED

Drove the real opencode GUI in a browser (instrumented `fetch`/XHR/EventSource + the Performance API + read the
client bundle `assets/index-*.js`). Definitive:

1. **The signal is the `?directory=` QUERY, not the header.** The client's request interceptor (`Mxe` in the bundle)
   runs on GET/HEAD only, and — when a directory is active — **DELETES the `x-opencode-directory` header** and
   re-emits it as a `?directory=<encoded path>` query param. So the header is never sent; the query is. The
   desktop's `activeDirFromRequest` already reads `?directory=`, so **binding works** — and it's not chat-gated: a
   project's `/session`, `/config`, `/lsp`, `/vcs`, … GETs all carry `?directory=<projectdir>` from the moment the
   project opens.

2. **Home / no-project is a `/global/` PATH PREFIX carrying NO directory.** On the home screen every request is
   `/global/event`, `/global/config`, … with `directory` absent (confirmed via the Performance API: 15 requests,
   `directory=absent` on all). So a directory-based check can NOT see "home" — the desktop must key `none` off the
   `/global/` path prefix. This is the release signal; implemented in `binding.ts::classifySignal`.

3. **Opening a folder in opencode is cheap and auto-registers.** `GET /project/current?directory=<folder>` registers
   the folder as an opencode project (it then appears in `/project`) and returns its id (SHA1 of the worktree).
   Navigating the GUI to `/<id>` opens it, after which its requests carry `?directory=<folder>` → the follow-binding
   picks it up. This is the `openInOpencode` used after `volt init`.

4. **Registering alone is INVISIBLE in the UI.** opencode's home lists no registered projects — a fresh
   `?directory=`-registered folder does not appear there ("Nothing here yet"), so "register and let the user open it"
   is a no-op. That's why `openInOpencode` NAVIGATES the view (which does open it), rather than only registering.

### Consequence for the design

- **Binding driver = opencode, single source of truth (mirror model).** `volt init` no longer calls `bindWorkspace`
  directly (that fought the follow-driver and got released whenever opencode was elsewhere). Instead it creates the
  folder and `openInOpencode`s it; the follow-binding then binds it. This also enables **create-from-home**: the
  panel offers "create a workspace from a detected IDE project" in the unbound/home state, no throwaway folder first.
- **Deferred (Step 2, nice-to-have):** none currently — the navigate-to-open piece turned out cheap enough to ship
  now, so create-from-home is end-to-end.

---

## Fragility of the opencode integration + safeguards

The desktop has TWO classes of opencode integration:

- **Sanctioned + live-tested:** `OPENCODE_CONFIG_DIR` → the LSP + `volt` tool. Covered by `verify-opencode.ts`
  checks 1–2 (drives the real binary). A config-contract break goes red on the compat gate.
- **Reverse-engineered (undocumented GUI↔server wire):** the follow-binding (`?directory=` / `/global/`) and
  create-from-home (`/project/current?directory=` → id → `/<id>`). opencode can change these on any release, and the
  binding would break **silently**. This was previously covered by NOTHING.

Two safeguards added:

1. **Observability canary** (`main.ts`): if opencode's GUI loads but Volt classifies NO active-project signal within
   ~20s (`bindStale`), the panel replaces the endless "Connecting…" with a visible warning + a console line. Turns a
   silent wire break into a reported one. Purely observational — never touches opencode or the binding path.
2. **Compat wire check** (`verify-opencode.ts` check 3, `verifyWire`): spawns a live `opencode serve` and asserts the
   exact wire facts the desktop depends on (serve URL parse, `/project`, `?directory=` auto-register+id, `/<id>`
   route, `x-opencode-directory` still in the client bundle). An opencode bump that moves the wire fails `bun run
   compat` instead of shipping. Read-only + one temp-dir register; the server is always killed.

### Is a SAFER integration available? (checked against the opencode SOURCE — definitive)

Verified against the opencode repo (`anomalyco/opencode`, `packages/plugin/src/index.ts` + the docs), not just
binary strings. The **complete** opencode event list is: `command.executed`, `file.edited`,
`file.watcher.updated`, `installation.updated`, `lsp.*`, `message.*`, `permission.*`, `server.connected`,
`session.*` (created/idle/updated/…), `todo.updated`, `tool.*`, `tui.*`.

- **There is NO `project.*` / "project opened" / "active project changed" / "directory switched" event.** Every
  event and every plugin hook (`event`, `chat.message`, `tool.execute.*`, `session.*`) is **activity-gated** — it
  fires on a chat / file edit / tool run / session change, never on passive project navigation or landing on home.
  (The `project.open`/`project.current` strings in the binary are TUI commands / SDK routes, not bus events.)
- The plugin `PluginInput` context carries `directory` + `worktree`, but that's the scope the plugin was invoked
  for, with **no "changed" signal**, and the plugin runs INSIDE opencode's process → it would still need a
  callback channel to reach the desktop (Electron main).
- **Conclusion (source-verified):** the request-sniff is not merely the most complete option — it is the ONLY
  mechanism that sees passive project navigation, which is exactly what bind/release needs. A plugin/event approach
  would be BOTH less complete (blind to passive navigation) AND more complex (in-process + callback). Keep the
  sniff, guarded by the runtime canary + the compat `wire` check. No plugin/event integration is worth pursuing;
  there is no navigation event to build on.

---

## opencode is SESSION-scoped, not project-scoped (the decisive live finding)

Debugging the user's "only detects the project once a chat starts" report, driven live against a **fresh,
session-less project**:

- On that project's new-session screen — visually "in" the project, before any chat — the client's own
  `GET /project/current` returns **`{"id":"global"}`**. opencode does NOT consider you in the project yet.
- The project only becomes the active scope once you **create a session** (the first chat, which stores it). That's
  when a plaintext project directory first appears — in the `x-opencode-directory` **header on POST requests** (the
  `Mxe` interceptor only strips/encrypts the header on GET/HEAD, so POSTs keep it plaintext).
- The `?directory=` on GET requests is **encrypted** (~26 opaque bytes; decoding shows binary with U+FFFD), so it is
  **not usable as a filesystem path** — `existsSync` always fails on it. Replaying it to `/project/current` resolves
  to `global` (the client is genuinely global-scoped pre-session).

**Consequences (unavoidable — opencode's architecture):**

1. **Binding is inherently post-chat.** There is no earlier signal; opencode itself doesn't know your project until a
   session exists. Pre-chat binding via the sniff is impossible.
2. **`global` is ambiguous** — it is opencode's home screen AND every new-session draft. So a release-on-`global`
   rule (the earlier `/global/` release) unbinds the panel every time you open a draft. **Decision: STICKY binding —
   bind on the first project directory, rebind on a different one, never release.** `global` only clears the
   cold-start "Connecting…" so the create surface can show. (User's call: "start simple and stable, see if enough.")
3. **create-from-home is register-ONLY.** `openInOpencode` (navigate to `/<id>`) landed on a global-scoped draft and
   bound nothing → replaced by `registerInOpencode` (register the folder, tell the user to open it + start a
   session). Simpler, and matches opencode's model.

Open follow-up if sticky isn't enough: distinguish home from draft via the embedded view's URL (`/` vs
`/new-session`) to release on true home only — deferred.
