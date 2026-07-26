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
