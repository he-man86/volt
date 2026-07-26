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

## 4. Reconciliation — precise, and the hard parts

```
desired = { p : ∃ non-expired session s with p ∈ s.interests } \ forceOff
reconcile (serialized, on: any /sync, lease sweep, or detected-project change):
  for each detected project p:
     want    = p ∈ desired
     serving = bridge reports p serving
     if want and not serving:  bind p on its host   (host may already serve a sibling — see §5)
     if serving and not want:  unbind p on its host  (subject to §6 grace)
```

- **Serialized** like today's `_refreshGate` — bind/unbind are async pipe ops; never run two reconciles at once.
- **Idempotent** — acts only on the diff, so re-running it (every sync) is cheap and safe.

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

### 6. Startup grace — do NOT flap

On connector startup (or restart — the IDE hosts stay live across it), `desired` is empty until clients re-sync
(~one poll). A naive reconcile would immediately unbind every serving project, then re-bind it a few seconds later
when clients re-declare — a visible flap and a needless sync interruption. Guard: the reconciler **only unbinds after
a startup stabilization window (~2× the poll, ~8s)**, giving live clients time to re-declare their interests. Binds
are never delayed (connecting something wanted is always safe); only the *unbind* side waits out the grace. After the
window, an unwanted-serving project is unbound normally.

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

## 8. Migration & version skew — the real trap

The connector **auto-updates independently** of the frontends, so during an update an **old frontend can talk to a
new connector** (or vice-versa). To avoid a window where sync silently stops:

- The new connector **keeps the legacy `POST /connect` / `POST /disconnect` / `GET /status` endpoints** as a thin
  compatibility shim mapped onto ONE implicit, never-expiring **"legacy session"**: a legacy `connect X` adds X to the
  legacy session's interests; `disconnect X` removes it; `GET /status` returns the derived `ConnectorView`. An old
  frontend therefore keeps working (with the old single-owner semantics) against the new model.
- A **new** `@volt/control` prefers the session API and falls back to legacy `/connect` only if `POST /session`
  404s (an old connector). So new-frontend↔old-connector also degrades gracefully to the legacy behaviour.
- The legacy shim is removed only once a floor connector version is guaranteed — noted, not rushed.

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
| The connector restarts | Startup grace (§6); clients re-sync within a poll and re-declare |
| An IDE restarts (new host/pipe) | Interest is the binding identity (§1), re-resolved each reconcile → re-binds the new host |
| Two clients want two projects on ONE TwinCAT worker | Hardware limit (§5): serve the most-recently-declared; others report idle |
| Old frontend ↔ new connector (or reverse) during an update | Legacy shim / client fallback (§8) |
| Two clients want the SAME project; one leaves | Union: still wanted by the other → stays serving (the whole point) |

## 11. Testing

- **C# (`Volt.Cli.Connector.Core`):** the reconciler is a pure function of `(sessions, forceOff, detected, nowUtc)` →
  desired bind/unbind actions. Unit-test it directly (no bridges): union of interests; a lapsed lease drops out; the
  startup-grace suppresses unbind then releases it; force-off wins; contended-host picks the most-recent; a durable
  interest re-resolves to a new id. Keep the actual bind/unbind (the pipe ops) behind an injected interface so the
  reconciler is tested without a live IDE.
- **`@volt/control`:** the session client (open → sync declares the current interest set → renew → DELETE on close);
  `enterWorkspace`/`leaveWorkspace` mutate the set; the legacy fallback path on `POST /session` 404. Same mock-fetch
  harness as `connector.test.ts`/`reconnect.test.ts`.
- The full loop (clients ↔ connector ↔ bridges) is the e2e layer; the pure reconciler + the control client are where
  correctness is actually pinned.

### Existing-test impact (audited against `packages/volt-cli/test`)

- **Untouched, stays green** — everything below/beside the connect/disconnect primitive: `Volt.Engine.Tests/*`, all
  `test/e2e/*` (they drive the **bridge pipe** directly; `bridge.connect/disconnect` = the host `select`/`deselect`
  the reconciler still calls — the gate is unchanged), `Volt.Cli.Tests/*` (CLI reaches the pipe directly), and the
  connector **detection** tests (`PerPipeProjectSource`, `TwincatSupervisor`, `TwincatXaeProbe`, `WireContract*` — the
  `health.projects ↔ DetectedProject` shape and the `{project}` bind payload survive verbatim).
- **Kept via the legacy shim** — `DisconnectLifecycleTests` and the selection half of `ConnectionManagerTests` call
  `ConnectAsync`/`DisconnectAsync`/`ActiveConnection`; the §8 shim maps those onto the implicit legacy session, so they
  pass unchanged and become the **legacy-caller regression suite**. The detection half of `ConnectionManagerTests`
  (merge, same-name collapse, concurrent/torn-generation, `RefreshIfStale`) stays as-is — the immutable-`State`
  discipline carries into the reconciler.
- **Retired as newly-impossible (the stability win)** — `Connect_invalidates_the_status_cache…` (+ Disconnect twin)
  guard the imperative-connect + 1s-stale-cache flash; declarative reconcile derives serving every sync, so that race
  is gone. `Connecting_one_project_clears_any_other_active_connection` pins single-owner — the exact multi-client bug
  this change removes.
- **Extended** — `ControlHarness/Program.cs` + the `@volt/control` client tests gain the `POST /session/{id}/sync`
  path and a legacy-fallback (`POST /session` 404 → `/connect`) test.

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

4. **Per-row `status` is the connection truth; the single highlight is retired.** Frontends read each row's `status`
   (`healthy`/`degraded` = connected) — they already do, and reconcile drives it correctly for N simultaneous projects.
   The removed `ActiveConnection`/single `Connected` had no data role. Tray colour = `Aggregate()` over the **serving
   rows** (green iff ≥1 row serves), not over a highlight. `ProjectView.Connected`, if kept at all, is cosmetic: in a
   `/sync` response it may mean "in THIS session's interests"; the legacy `/status` keeps the legacy session's last pick.
   No frontend may re-introduce a dependency on it.

5. **`forceOff` is connector-lifetime by design.** The tray force-off lives in connector memory and is intentionally
   **not persisted** — a connector restart clears it (the "stuck bridge" it guarded is a fresh process anyway). Stated as
   scope, so its absence after a restart is not read as a bug.

6. **Lease TTL ≥ 3× the poll**, so a single missed/slow poll never drops a live client's interests (which would flap its
   project unbound-then-rebound). A client stalled for >2 polls does flap — the accepted, self-healing tail, and the
   reason the TTL is generous rather than tight.

7. **The legacy shim composes by union, never clobbers.** Legacy `connect X`/`disconnect X` mutate the *one implicit
   legacy session's* interests; `desired` still unions it with every real session. So an old frontend and a new one
   coexisting on the same connector cannot un-serve each other's projects — the whole point of the union holds across the
   skew too.

## 13. Why this is right (and what it retires)

- **Declarative** beats imperative: idempotent interest sets have no counting/ordering/leak bugs.
- **Presence/leases** make crash + restart *the same* case as a clean leave.
- **One derived source of truth** (serving = reconciled from interests) retires: the imperative connect/disconnect
  mutation, the one-at-a-time `Selected`/`ActiveConnection` highlight, "connected == a highlight," and every
  ref-leak/crash-cleanup patch the counter would have needed.
