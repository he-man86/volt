## Analyse first: PLCAssist may have misread this

This is a request from PLCAssist (a client of the bridge) written from the OUTSIDE: what our logs observed, and our
reading of volt's code to explain it. The observations are recorded facts. The explanation and the requested change
are our interpretation, and may be wrong — about the cause, about whether it is a gap at all, or about volt's intent.

Before any work: verify the observation, then confirm or refute our reading. If the behaviour is intended, already
covered by another route, or the gap is ours (the client using the wire wrongly), record that here with the reason and
stop — that answer is as useful to us as a fix. Only a confirmed real gap that fits volt's design goes on to the tasks.

## Why

**A relayed op has no deadline below the relay, so a push or build that waited past the caller's budget still starts
in the IDE, for nobody.** The relay has already answered its caller "timed out, outcome unknown"; the bridge cannot
know that, and starts the work anyway.

What PLCAssist sees (CODESYS bridge, volt `457b6a700b`, log `codesys-2026-10-03.log`):
- Four builds received 18:51:05 (`r3-a76996ea`), 18:52:51 (`r1-5deb709e`), 18:54:29 (`r1-4f8a0358`) and 18:55:34
  (`r2-28268d11`) answered `-> build (…) ok` at 18:58:01, 18:57:46.9, 18:57:46.4 and 18:57:45.9: 415, 295, 196 and
  131 s. PLCAssist's relay gives up at 60 s (`RELAY_TIMEOUT`, outcome unknown), so all four results arrived as
  "late terminal frame … (already settled)" and were discarded. Each later build was a retry of an earlier one.
  Honest limit: on CODESYS these builds did not queue, they nested (see `codesys-build-nesting`), so each STARTED in
  time and this change alone would not have refused them. It would refuse them once ops are serialized (that change
  turns nesting into queueing), and it applies today on TwinCAT, whose STA queue is serial.
- The same shape on a push is worse: a push queued behind a long op starts after the client was told "unknown".
  The client re-reads, sees nothing changed (the push has not started yet), and plans from that; or it gives the
  write up. The push then lands anyway. The lease (`expectedProjectVersion`, `ifVersion`) keeps a late push and a
  re-send from BOTH applying, which is why this is not critical — but it cannot stop a write the client abandoned,
  and it cannot make "re-read and compare" give the right answer while the push is still queued.

What the code shows (volt `457b6a700b`):
- The request frame is `{ id, op, body }` (`docs/relay-protocol.md:77-81`); nothing in it says when the caller stops
  waiting.
- `RelayTunnel.ServeAsync` (`Volt.Relay/RelayTunnel.cs:277-287`) runs `PipeClient.Call` in `Task.Run` with no
  deadline. `PipeClient.Call` (`Volt.Wire/PipeClient.cs:30`) bounds only the 2 s pipe connect.
- `PipeRequest` (`Volt.Wire/PipeMessages.cs:9-13`) is `op` + `body`; the host cannot be told a deadline either.
- The wait is on the IDE thread, not in the tunnel: `DriverBase.RunOnStaThread` (`Volt.Engine/Ide/DriverBase.cs:118-129`)
  → CODESYS `InvokeInPrimaryThread(…, bAsync:false)` (`Volt.Ide.Codesys/Ide/CodesysDispatcher.cs:55-69`). The comment
  at `DriverBase.cs:52-55` says it: "neither dispatcher can time out".
- `relay-protocol.md:229-232` already tells a relay that a timed-out push "may well have applied". This request is the
  other half: let the bridge refuse to START what the caller has already given up on.

## Gate: only where it matches volt's design

This is what PLCAssist NEEDS, not a design handed to volt. Check it first against: "Do not interpret op bodies" (so a
deadline belongs on the frame, not in `body`), "no negotiation" (a relay that sends no deadline must get today's
behaviour), "one entry point, every guard on it" (the check belongs in the pipe host / `OpGuard`, not the tunnel),
and "a write must not be aborted half-way" (the deadline only ever refuses to START; it never cancels a running op).
Implement only what fits; record what does not and the volt-native alternative.

## What Changes

- **The request frame MAY carry a budget**: `{ id, op, body, budgetMs }`, the milliseconds the caller will still wait,
  measured from the moment the bridge reads the frame. Relative, so a laptop clock that disagrees with the relay's
  does not matter. Volt may prefer another shape (absolute time, a name other than `budgetMs`); PLCAssist adapts.
- **The tunnel turns it into a local deadline** and passes it on the pipe request (a new optional `PipeRequest`
  field), so the host can check it where the queue actually ends.
- **The host refuses to start an expired op**: when a `push` or `build` (and, if volt agrees, `fetch`/`refs`) gets the
  IDE thread after its deadline, it answers a new coded error `DEADLINE_EXCEEDED` ("not started: nothing applied")
  without touching the project. An op that started before its deadline runs to completion as today.
- `health` is unaffected (it never marshals).
- No budget on the frame = no deadline = today's behaviour (the CLI and every older relay).

## Impact

- `docs/relay-protocol.md` (request frame, errors), `Volt.Relay/RelayFrames.cs` (read `budgetMs`),
  `Volt.Relay/RelayTunnel.cs`, `Volt.Wire/PipeMessages.cs`, `Volt.Engine.Host/BridgePipeHost.cs` or `OpGuard`,
  `Volt.Contracts` `BridgeErrorCodes.DeadlineExceeded`, regenerated wire docs.
- Clients: PLCAssist's relay would send `budgetMs = its own timeout − a margin` and map `DEADLINE_EXCEEDED` to
  "not applied, safe to repeat" instead of "outcome unknown".

## Volt's assessment (2026-10-03)

**Verdict: NOT VALID as a separate mechanism.** The gap is real only for a write that waits behind another write.
`codesys-build-nesting`'s `IDE_BUSY` refusal closes that without a deadline.

- The build timings (415, 295, 196 and 131 s) in `codesys-2026-10-03.log`: CONFIRMED. PLCAssist's own "honest
  limit" is also right: on CODESYS these builds nested rather than queued (see `codesys-build-nesting`).
- The request frame is `{ id, op, body }` (`relay-protocol.md:77-81`): CONFIRMED. `ServeAsync` runs the pipe call in
  `Task.Run` with no deadline (`RelayTunnel.cs:277-287`): CONFIRMED. `PipeClient.Call` bounds only the 2 s connect
  (`PipeClient.cs:30-33`): CONFIRMED. `PipeRequest` is `op` + `body` (`PipeMessages.cs:9-13`): CONFIRMED.
  "Neither dispatcher can time out" is at `DriverBase.cs:51-55` at `457b6a700b`; it has moved about 10 lines in the
  working tree: CONFIRMED. `relay-protocol.md:229-232`: CONFIRMED.
- "A push queued behind a long op starts after the client was told unknown": true on TwinCAT today, and it would
  become true on CODESYS if nesting were simply turned into queueing. It stops being true once a write that arrives
  during a write is refused instead of queued.

**Why not.** With `IDE_BUSY`, a push or build never waits behind another push or build. The only things a write can
still queue behind are a read and the health probe's refresh, which take seconds, well inside a 60 s relay budget. A
deadline would add a frame field, a pipe field, a clock and a new error code, all to cover a window the gate already
closes. It would also be a second mechanism for the same question. A read that starts after its caller gave up
wastes some IDE time but changes nothing. Unknown frame fields are already ignored (`RelayFrames.Read` reads only
`id`, `op` and `body`), so a relay that sends `budgetMs` breaks nothing.

**What PLCAssist should do instead:**
- Map `IDE_BUSY` to "not applied, safe to repeat once the running op is done".
- Keep "outcome unknown" only for a request whose socket dropped, or whose budget ran out while the op was RUNNING.
- Resolve "unknown" the way the protocol already says (`relay-protocol.md:137-139`). Re-send the IDENTICAL push, with
  the same `expectedProjectVersion` and `ifVersion`: it either applies once or is refused as stale. Or read.

**Plan: WILL NOT BUILD** the budget field, the pipe deadline or `DEADLINE_EXCEEDED`. What Volt builds in their place,
"a write never waits queued behind another write", is delivered by `codesys-build-nesting`. The spec below states that
guarantee from the relay's side, and this change closes when `codesys-build-nesting` is archived. WHEN: with
codesys-build-nesting, the first of these five, in Volt's bridge lane after bridge-refusal-review and the three
earlier requests (directed-library-signatures, push-partially-applied-flag, st-roundtrip-fixed-point).
