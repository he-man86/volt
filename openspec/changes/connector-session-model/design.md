# Design — connector session/interest/reconciliation model

## The model in one paragraph

Each client (a desktop instance, a VS Code window) opens a **session** with the connector and holds a **lease** by
renewing it periodically. Within its session a client declares its **interests** — the projects it is currently
using (0..n). The connector continuously computes `desired = ⋃ interests over all non-expired sessions` and
**reconciles** the bridges toward it: a project's host is bound (serving) iff the project is in `desired` and not
force-off; otherwise it is unbound. Nothing is imperative — clients declare *what*, the connector decides *how*.

## 1. Interest identity — just the workspace's binding

An interest is the workspace's **binding identity `{vendor, projectName}`** — exactly what `readBoundProject` returns
and what `matchesBinding` already routes on. It is **not** a new identity and it does **not** disambiguate same-name
projects (it can't — see below). It is passed *whole* so the **connector** resolves it to the current detected
project (the connector owns the detected list). Two consequences, both from resolving connector-side:

- A workspace can declare interest **before its IDE is open**; the connector binds the project the *moment* it
  appears (no client-side pre-resolution, no wait-until-detected).
- An IDE restart re-resolves cleanly — the binding identity doesn't change, so the reconciler re-binds the new host.

### Same-name projects are OUT OF SCOPE (an existing, unrelated gap)

The connector's identity is `vendor + name` with the **per-instance handle deliberately removed** (see
[[identity-is-vendor-plus-name]]). So two projects sharing a name **collapse to one identity** — whether it's a
CODESYS "Main" + a TwinCAT "Main", **or two CODESYS instances each with a "Main."** Vendor does not fix this; nothing
in the current identity does. This change **inherits** that collapse and does not try to solve it. Covering the gap
would require re-introducing a **per-instance identity** — a deliberate reversal of a past decision, and a **separate
change**, not this one. (So: do not add anything to the interest for same-name; it wouldn't help.)

## 2. The API — declarative, folded into the existing poll

```
POST   /session                         → { sessionId, leaseSeconds }        // open a session
POST   /session/{id}/sync { interests:[{vendor,projectName}…] } → ConnectorView   // declare desired set + renew lease + read live status, ONE call
DELETE /session/{id}                    → 204                                 // clean shutdown (optional; a crash is covered by lease expiry)
```

- The clients **already** poll status every ~4s. That poll *becomes* `/session/{id}/sync`: it declares "here's what
  I'm on right now," renews the lease, and returns the live `ConnectorView`. No new traffic, no separate heartbeat.
- `interests` is the **full current set**, declared every sync — idempotent. There is no add/remove delta to lose,
  no ordering to preserve, no count to leak. `enterWorkspace`/`leaveWorkspace` just mutate the client's local set;
  the next sync ships it.
- `ConnectorView` keeps its shape (`Projects[]` each with per-project `Status` idle/healthy/degraded), so the
  frontends read their own project's row exactly as today. (Optionally add `usedBy` counts per row for presence UI —
  a nice-to-have, not required.)

## 3. Leases — presence and self-healing

- A session's lease has a TTL of **≈ 3× the poll interval (~12–15s)**; every `/sync` renews it. A session whose lease
  lapses (client crashed, or lost the connector) is **expired** and its interests drop out of `desired`.
- This is why the model is self-healing: **a client going away — cleanly or by crash — is just "its interests
  disappeared."** No explicit disconnect is required for correctness; `DELETE /session` only makes a clean shutdown
  *immediate* instead of waiting out the TTL.
- The lease sweep runs on the connector's existing tick.

## 4. Reconciliation — bind is level-triggered, unbind is edge-triggered

The subtlety that makes this correct: **a bridge SERVES BY DEFAULT** — a loaded IDE host serves its project the
moment it loads (verified: `Disconnecting_one_host_leaves_every_other_host_serving` expects an un-connected neighbour
to keep serving; `volt push` from a terminal, with no GUI session at all, relies on it). So a naive "serve iff wanted"
would gate every bridge no session has declared — cutting off standalone CLI and gating a neighbour the instant you
connect something else. The fix is an **asymmetry**:

```
wanted = { p : ∃ non-expired session s with p ∈ s.interests } \ forceOff   (resolved to detected projects by vendor+name)
reconcile (serialized, on: any /sync, lease sweep, or detection change), given previouslyWanted:
  # RESUME — level-triggered: any wanted-but-idle project (honouring one-per-host, §5)
  for each host (projects sharing a pipe):
     if some wanted row already serves here: leave it (incumbent holds)
     else bind one wanted-but-idle row (deterministic pick)
  # GATE — edge-triggered: only what we were serving on a client's behalf and the LAST session just left, or force-off
  lost = previouslyWanted \ wanted
  for each detected serving p where p ∈ lost or p ∈ forceOff:  unbind p
  publish wanted  (becomes next pass's previouslyWanted)
```

- **A bridge no session ever wanted is never gated by the loop** — it keeps its default serving state. Only the
  wanted→unwanted *edge* (the last interested session leaving, cleanly / by empty-sync / by lease expiry) gates a
  project, plus the tray force-off. This is what preserves standalone `volt push` and the untouched-neighbour guarantee.
- **Serialized** under the single gate; bind/unbind are async pipe ops, never two reconciles at once.
- **Self-correcting** — `serving` is read from the bridge every pass and the plan acts only on the diff, so re-running
  it (every sync) is cheap, safe, and converges (a second pass over the applied state is a no-op — a pinned invariant).

### 5. Parallelism is the norm; one narrow shared-host case

**Wanted projects serve in parallel — that is the common case, not an exception.** Both vendors are **per-pid**
(`volt.bridge.<vendor>.<pid>`, one pipe per running IDE process — `PipeNames`), so N projects across N IDE instances
map to N independent pipes and all bind at once. `parallel-instances.test.ts` proves two CODESYS serving distinct
projects simultaneously with no cross-stall. The reconciler binds *every* wanted project; nothing is serialized across
hosts.

The **one** contention case: a single **TwinCAT XAE window** whose solution holds **≥2 Volt-managed projects**. That
one worker (one pid, one pipe) serves one selected project at a time, and its gate is per-host (`ConnectionManager`
comment). CODESYS never hits this (one project per IDE process); TwinCAT only if two *wanted* projects share one XAE
solution. Policy there is simply the bridge's **existing** behaviour — the worker serves its selected project and
reports the sibling `status:"idle"` ("not connected — reconnect"). The reconciler needs **no special most-recent-wins
logic**: it declares both wanted, the worker can bind one, the other stays idle until selected. Not a bug — the
bridge's own limit, already handled below the reconciler.

### 6. No startup grace needed — edge-triggering subsumes it

An earlier draft added a startup stabilization window so a just-restarted connector would not unbind every serving
project before clients re-declared. **Edge-triggered gating (§4) removes the need for it entirely**: after a restart
`previouslyWanted` is empty (fresh process), so there are *no* leave-edges — nothing serving is gated, everything
keeps serving, and clients simply re-declare their interests over the next poll. A window that only ever suppressed a
flap the model no longer produces is dead weight, so it was dropped (`After_a_connector_restart_nothing_is_gated…`
pins this). One consequence, accepted: a client that crashed *during* the restart window has no lease in the fresh
process, so its project keeps serving (the safe default) until something declares or force-offs it.

## 7. Manual controls, redefined correctly

- **A frontend's Disconnect** = *drop this project from MY interests* (and stop re-adding it until the user
  reconnects). It un-serves the project **only if no other live session still wants it** — the correct multi-client
  behaviour, for free from the union. (Today's per-workspace disconnect that "gates the bridge" is replaced by simply
  not wanting it.)
- **A frontend's Connect** (override/retry) = *(re-)add it to my interests now* + force an immediate `/sync` so the
  reconcile happens without waiting for the next poll (the "IDE bridge dropped, reconnect without re-navigating"
  case).
- **The tray's Disconnect** = a connector-held **force-off** for a project id: reconciliation keeps it unbound
  regardless of interests until cleared. This is the supervisor escape hatch (a stuck/misbehaving bridge) — the ONE
  place a connector-side override is right, because the tray is a supervisor, not a project view.

## 8. No legacy shim — one control surface

An earlier draft kept the old `POST /connect` / `POST /disconnect` endpoints as a compatibility shim (mapped onto an
implicit "legacy session") so an un-updated frontend would keep working during a staged update, with `@volt/control`
falling back to them on a `POST /session` 404. **That shim was removed entirely** — no `/connect`, no `/disconnect`, no
implicit legacy session, no client fallback, no single-owner highlight. The session API is the ONLY way to drive
serving; `GET /status` is the ambient detected-list read. Both the connector and the frontends are Volt's own and
auto-update together, so the transient skew window the shim guarded is not worth the permanent complexity of a second
control plane. (`ConnectAsync`/`DisconnectAsync`/`ActiveConnection`/`SelectedOf`/the `Connected` highlight,
`connectProject`/`disconnect`/`DisconnectResult`, and the client `legacy` mode are all gone.)

## 9. Frontend impact is small (the wiring already shipped)

`connection-follows-active-project` already put `enterWorkspace(root)` / `leaveWorkspace(root)` at the right call
sites (desktop bind/unbind, VS Code activate/deactivate). This change keeps those call sites; only their
**implementation in `@volt/control`** moves from "POST connect/disconnect" to "mutate my interest set; the session
sync poll declares it." A single per-app **session** (opened on first `enterWorkspace`, its sync poll running while
the app lives, `DELETE`d on quit/deactivate) carries the interest set. `boundStatus`/`connectorStatus` read the
`/sync` response.

## 10. Failure modes — each has an answer

| Failure | Handled by |
|---|---|
| A frontend crashes without disconnecting | Lease expiry drops its interests → reconcile unbinds if no one else wants them |
| The connector restarts | Edge-triggering (§6): `previouslyWanted` is empty → no leave-edges → nothing serving is gated; clients re-declare over the next poll |
| An IDE restarts (new host/pipe) | Interest is the binding identity (§1), re-resolved each reconcile → re-binds the new host |
| Two clients want two projects on ONE TwinCAT worker | Hardware limit (§5): the incumbent holds, the sibling reports idle; no thrash |
| Two clients want the SAME project; one leaves | Union: still wanted by the other → stays serving (the whole point) |

## 11. Testing

- **C# (`Volt.Cli.Connector.Core`):** the reconciler is a pure function of `(sessions, forceOff, previouslyWanted,
  detected, nowUtc)` → bind/unbind actions. Unit-test it directly (no bridges): union of interests; the wanted→unwanted
  leave edge gates while a never-wanted serving bridge is left untouched; a lapsed lease drops out; force-off wins; the
  shared-worker incumbent holds without thrashing; a durable interest re-resolves; and a second pass over the applied
  plan is a no-op (convergence). The bind/unbind (pipe ops) route through the existing `IProjectSource` seam, so the
  manager's session loop is tested against the fake sources with no live IDE. *(Done — `ReconcilerTests` 18,
  `ConnectionManagerSessionTests` 6.)*
- **`@volt/control`:** the session client (open → sync declares the current interest set → renew → DELETE on close);
  `enterWorkspace`/`leaveWorkspace` mutate the set. Same mock-fetch harness as `connector.test.ts`/`reconnect.test.ts`.
- The full loop (clients ↔ connector ↔ bridges) is the e2e layer; the pure reconciler + the control client are where
  correctness is actually pinned.

### Existing-test impact (audited against `packages/volt-cli/test`)

- **Untouched, stays green** — everything below/beside the connect/disconnect primitive: `Volt.Engine.Tests/*`, all
  `test/e2e/*` (they drive the **bridge pipe** directly; `bridge.connect/disconnect` = the host `select`/`deselect`
  the reconciler still calls — the gate is unchanged), `Volt.Cli.Tests/*` (CLI reaches the pipe directly), and the
  connector **detection** tests (`PerPipeProjectSource`, `TwincatSupervisor`, `TwincatXaeProbe`, `WireContract*` — the
  `health.projects ↔ DetectedProject` shape and the `{project}` bind payload survive verbatim).
- **Deleted with the legacy plane** — `DisconnectLifecycleTests` and `CodesysSourceLiveTests` were entirely the
  imperative `ConnectAsync`/`DisconnectAsync`/`ActiveConnection` facade; with that facade removed they are gone. The
  live-pipe **gate** they proved is covered by `test/e2e/lifecycle/disconnect-cycle.test.ts`; the reconcile bind/unbind
  by `ConnectionManagerSessionTests` + `ReconcilerTests`. `ConnectionManagerTests` keeps only its detection/aggregate/
  concurrency half (the immutable-`State` discipline carries into the reconciler); the selection half is deleted.
- **Extended** — `ControlHarness/Program.cs` gained the session endpoints (a simple interest→serving reconcile);
  `ControlServerTests` + `@volt/control`'s `session.test.ts` + the cross-language `connector.e2e.test.ts` all test the
  session wire (open → declare → reconcile → drop → close). `ControlServerTests`' legacy `/connect`,`/disconnect` cases
  and `session.test.ts`'s legacy-fallback block were deleted.

## 12. Correctness invariants (the non-negotiables — pin these or it drifts)

These close the gaps a "quick fix" would later paper over. They are requirements on the implementation, not options.

1. **One serialization domain.** Detection refresh, session mutation (`Sync`/`OpenSession`/`CloseSession`/lease sweep),
   and reconcile all run under the **single existing gate** (`_refreshGate`) and publish through the **one immutable
   `State`**. A session's interest update is a **read-modify-write of the sessions map under the gate** — never a
   lock-free volatile swap — or two syncs landing together lose one session's interests. (The `Readers_never_see_a_torn_generation`
   discipline already in `ConnectionManager` is the model; the sessions map joins it.)

2. **Serving is read from the bridge, never cached as truth.** Each reconcile pass computes `serving` from the bridge's
   *actual* per-row report (as `WireProjects.Flatten` does today) and acts on the diff to `desired`. Bind/unbind are
   **best-effort**: a failed bind leaves the row unbound and the **next pass retries** — there is no desired-equals-done
   bookkeeping to get out of sync. This is what makes the loop self-correcting.

3. **The interest set is authoritative mutated state, edge-triggered.** `enterWorkspace`/`leaveWorkspace`/manual
   Disconnect/manual Connect **mutate** the client's local interest set; the sync poll ships that set **verbatim**. It is
   **not re-derived from "currently-open workspaces" each poll** — so a manual Disconnect (drop interest) **stays**
   dropped until a real `enterWorkspace` edge (re-navigation) or Connect re-adds it. `enter/leave` are navigation
   *transitions*, not a level re-asserted every tick, so nothing silently clobbers the manual override. No per-workspace
   "suppressed" flag is needed — the mutated set already is the state.

4. **Per-row `status` is the connection truth; the highlight is deleted.** Frontends read each row's `status`
   (`healthy`/`degraded` = connected) — they already did, and reconcile drives it correctly for N simultaneous
   projects. `ActiveConnection`/`SelectedOf`/the `ProjectView.Connected` highlight had no data role and were **removed
   from the wire and the client** (`DetectedProject.connected` too). Tray colour = `Aggregate()` over serving ∧ wanted
   rows, not a highlight.

5. **`forceOff` is connector-lifetime by design.** The tray force-off lives in connector memory and is intentionally
   **not persisted** — a connector restart clears it (the "stuck bridge" it guarded is a fresh process anyway). Stated as
   scope, so its absence after a restart is not read as a bug.

6. **Lease TTL ≥ 3× the poll**, so a single missed/slow poll never drops a live client's interests (which would flap its
   project unbound-then-rebound). A client stalled for >2 polls does flap — the accepted, self-healing tail, and the
   reason the TTL is generous rather than tight.

## 13. Why this is right (and what it retires)

- **Declarative** beats imperative: idempotent interest sets have no counting/ordering/leak bugs.
- **Presence/leases** make crash + restart *the same* case as a clean leave.
- **One derived source of truth** (serving = reconciled from interests) retires: the imperative connect/disconnect
  mutation, the one-at-a-time `Selected`/`ActiveConnection` highlight, "connected == a highlight," and every
  ref-leak/crash-cleanup patch the counter would have needed.
