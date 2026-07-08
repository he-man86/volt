## Why

`volt-git` only learns of an IDE-side change when someone runs `volt status` / `volt pull` — a `/refs` fetch
diffed against the sidecar baseline. So a long-lived consumer (the VS Code drift view, the desktop IDE-changes
panel) shows **stale** state after an engineer edits in the IDE, until a manual refresh. We want the bridge to
**push** a "project changed" event so those consumers react immediately — no manual refresh, and no client
sitting in a constant `/refs` (or even `/version`) poll loop.

## Approach: push at the wire, hide the detection

An IDE edit is **spontaneous** — no client is waiting on a request — so this is the real case for server push. The
design has two boundaries, and they're decided separately:

- **Consumer ↔ bridge (the wire):** a proper **event stream** — `GET /events` (SSE). A client opens it once and
  the bridge pushes `change` events. **No per-client polling.** This wire is identical for every vendor — it is
  the parity boundary.
- **Bridge ↔ IDE (detection):** an implementation detail *hidden behind that wire* — and a live `/debug?reflect=`
  probe confirmed **both IDEs expose real change events, so this is genuinely event-driven, no internal polling**:
  - **CODESYS** — the `IObjectManager` the bridge already holds fires `ObjectModified` (per-edit),
    `ObjectAdded`/`Removed`/`Renamed`/`Moved`, `ObjectPropertyModified`, and `ProjectDirtyChanged`/`ProjectSaved`.
    The bridge subscribes (via reflection — the handlers are typed) and raises the change source. (`GetLastChange`
    is a cheap-poll safety net only.) The `ScriptProject` wrapper alone only exposes `dirty`; the ObjectManager
    is where the real signal lives.
  - **TwinCAT** — VS DTE `SolutionEvents` / `DocumentSaved` / `ProjectItemsEvents`, same subscribe-and-raise.

  A single edit fires many `ObjectModified` events, so the source **coalesces** (trailing-edge debounce) into one
  `change` per burst. Either way the API layer reacts the same — the wire is identical for both vendors.

That separation is the whole point: the wire is designed properly and uniformly even when a vendor's internals
can't be.

## What Changes

- **`GET /events` (SSE).** A long-lived stream that emits a `change` event (carrying the new change token —
  `structureVersion` + a content token) whenever the loaded project changes, plus periodic keep-alives. Clients
  open it once; on a `change` they auto-refresh (fetch `/refs`, recompute drift, surface "IDE changed — pull").
- **An internal `IProjectChangeSource` seam (Core).** One vendor-neutral interface the SSE layer consumes.
  Implementations: TwinCAT subscribes to DTE events; CODESYS raises the same signal from its background probe
  (its content-token recompute is gated on the cheapest "changed-since" hint it has, so an idle project costs
  almost nothing). The SSE layer is identical across vendors.
- **Long-poll `GET /wait-change?since=<token>` as the pragmatic fallback** if SSE connection-management on
  `HttpListener` proves heavy — same semantics (block until change or timeout), one event per request, no
  persistent-connection bookkeeping. Additive; the SSE path is the target.
- **Scope: GUI consumers.** The extension / connector open `/events`; the CLI/AI stay request/response (they are
  invoked on demand, not watchers) and benefit indirectly from a fresher baseline.

**Non-goals:** no WebSocket (SSE is unidirectional server→client, which is all this needs); no per-item change
events on the wire (the token says THAT it changed; a `/fetch` delta says WHAT).

## Consumers (CLI · UI · AI)

- **UI** — the extension / connector subscribe to `/events` once and, on a `change`, auto-refresh the drift view
  and surface "IDE changed — pull". This is the primary consumer.
- **CLI** — a new `volt wait-change [--timeout]` command: subscribe to `/events` (or long-poll `/wait-change`),
  block until the next change, print the new token + a one-line summary, and exit 0 (or exit non-zero on timeout).
  So scripts and terminal users get event semantics from the request/response CLI without a daemon.
- **AI** — two clean paths: (1) reactive — `volt wait-change` lets the AI *block until the engineer changes
  something* and then `volt pull`, instead of guessing when to re-check; (2) on-demand — `volt status` stays
  instant/accurate because the GUI/daemon keeps the baseline fresh. The `volt` tool exposes `wait-change` as a
  read-only (non-mutating) verb.

## Clean implementation (not bolted on)

- **Reuse the existing versions — no parallel token.** The change token IS the `structureVersion` +
  `projectVersion` that `/refs` already computes and the sidecar baseline already tracks, so a `change` event
  correlates directly with `/refs`/`/fetch` — no second hashing scheme to keep in sync.
- **One internal seam.** `IProjectChangeSource` is the ONLY thing the SSE layer knows; the vendor detection
  (DTE event vs internal poll) lives entirely behind it. Adding a vendor = implement the seam, nothing on the wire.
- **Coalesce.** Rapid successive edits emit ONE `change` (trailing-edge/debounced), so a client never gets a
  refresh storm.
- **Lifecycle.** The SSE subscriber registry cleans up on disconnect; keep-alives detect dead connections. The
  stream never holds the STA thread.

## Docs

- **Update `packages/volt-bridge/openapi.yaml`**: document `GET /events` (`text/event-stream`, the `change` event
  + keep-alive) and the `GET /wait-change` long-poll (query `since`, the token response, the timeout status), so
  `/swagger` and contract consumers see the event surface.

## Impact

- `packages/volt-bridge` — `IProjectChangeSource` in Core + the SSE `/events` route (served off the marshalled
  thread; a thread-safe subscriber registry the change source fans out to); TwinCAT DTE-event source; CODESYS
  probe-driven source (the hidden internal poll); optional `/wait-change` long-poll. **Parity**: the `/events`
  wire is identical for both vendors.
- `packages/volt-git` — the change-token type; a reactive helper a long-lived consumer uses.
- `packages/volt-control` — subscribe to `/events`; emit a debounced "changed" signal to the renderer.
- `packages/volt-vscode` / `packages/volt-app` — auto-refresh the drift view on a `change` event + a subtle
  "IDE changed — pull" affordance.
- Composes with the existing background health-probe and the `.git/volt/ide-refs.json` baseline.
