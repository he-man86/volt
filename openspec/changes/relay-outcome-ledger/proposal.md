## Analyse first: PLCAssist may have misread this

This is a request from PLCAssist (a client of the bridge) written from the OUTSIDE: what our logs observed, and our
reading of volt's code to explain it. The observations are recorded facts. The explanation and the requested change
are our interpretation, and may be wrong — about the cause, about whether it is a gap at all, or about volt's intent.

Before any work: verify the observation, then confirm or refute our reading. If the behaviour is intended, already
covered by another route, or the gap is ours (the client using the wire wrongly), record that here with the reason and
stop — that answer is as useful to us as a fix. Only a confirmed real gap that fits volt's design goes on to the tasks.

## Why

**When the socket drops while a push runs, the push completes in the IDE and its outcome is thrown away. Afterwards
nobody — not the relay, not the client, not the bridge log at Info — can say whether that request landed.**

Background: Cloudflare restarts the relay's edge and Durable Object several times a day (measured by PLCAssist,
2026-10-03: 1006 on both ends, the bridge redials in 1-3 s). Those drops cannot be prevented, only ridden through. A
read is simply repeated. A push dropped mid-flight is "outcome unknown", and the client must re-read and compare.

What the code shows (volt `457b6a700b`):
- `RelayTunnel.cs:207-211`: in-flight requests are abandoned by contract — "we do NOT try to answer them on the next
  connection". `relay-protocol.md:137-139` gives the reason: `ifVersion` and `expectedProjectVersion` make a repeat
  either apply once or reject as stale.
- `RelayTunnel.cs:278-303`: the pipe call is not cancellable once started; when the connection goes, the call still
  finishes, the send of its result throws, and the only record is `relay: abandoned '<op>' — the connection went` at
  **Debug**. The outcome (accepted, conflicts, the new `projectVersion`) is not logged anywhere.
- The engine's own push lines (`PushService.cs:105,117,263,321,326`, e.g. `push 1 ops — accepted [updated: Main.pou]`)
  carry no relay id, because `PipeRequest` (`Volt.Wire/PipeMessages.cs:9-13`) has only `op` and `body`. Joining an
  IDE action to the request that caused it is done by timestamp. `BuildService.cs:58` logs a build's end at Debug
  only, and its start not at all.

Why the lease alone is not enough for a client that has to tell a user what happened:
- "Re-read and compare" is a guess. A client re-reads and sees the change: was it its push, or a colleague's edit
  in the IDE? It sees no change: did the push fail, or is it still queued?
- A client that re-plans from a fresh read and re-sends gets a fresh `expectedProjectVersion`, so the lease no longer
  connects the two attempts. A text patch (search/replace) that still matches can then apply twice. That part is
  PLCAssist's to fix (an idempotency key is on our side of the list too), but an authoritative "r5-0c1d2e3f was
  accepted at version X" closes it at the source.
- The relay's own timeout case (socket still up, result arrives late) is OURS: the bridge delivered it and our relay
  dropped it. This request is only about the case where the bridge could not deliver.

## Gate: only where it matches volt's design

This is what PLCAssist NEEDS, not a design handed to volt. Check it first against: "a request is never dropped:
exactly one terminal frame, or the socket closes" and "do not answer an id the relay has given up on" (so the report
must NOT be a second `result` frame for the id), "do not synthesize frames", and the CLI's own retry story. A relay
that does not understand the report must be able to ignore it (PLCAssist's relay today drops any untagged frame it
does not recognise without closing: `infra/relay-worker/src/volt-relay.ts` message handler). Implement only what
fits; record what does not and the volt-native alternative (for example a relayable `outcome {id}` query instead of
a pushed report).

## What Changes

- **The bridge keeps a small ledger of terminal outcomes it could not deliver**: per request id, the op, ok or the
  error code, and for a push the accept/refuse verdict and the resulting `projectVersion`; bounded (for example the
  last 32 entries or 15 minutes).
- **On the next connection, after `hello`, the bridge reports them once** in a frame kind of its own (for example
  `{ "outcomes": [ { "id", "op", "outcome", "code"?, "projectVersion"? } ] }`), never as a `result` for the id.
- **Every abandoned-after-completion request gets one Info line** with its outcome:
  `relay: push (r5-0c1d2e3f) completed after the connection went: accepted, version 9f3c…`.
- **The relay id reaches the engine's log lines**: the pipe request carries an optional request tag, and the push
  and build lines echo it (`push 1 ops — accepted [...] (id=r5-0c1d2e3f)`); the build gains an Info start and done
  line (errors, warnings, ms, id). The CLI sends no tag and its lines are unchanged.

## Impact

- `Volt.Relay/RelayTunnel.cs`, `Volt.Relay/RelayFrames.cs`, `docs/relay-protocol.md` (a new bridge→relay frame,
  documented as ignorable), `Volt.Wire/PipeMessages.cs` (optional tag), `Volt.Engine/Sync/PushService.cs` and
  `BuildService.cs` (log lines only).
- Clients: PLCAssist's relay would keep a short tombstone per timed-out or dropped id and resolve it from the report,
  so "outcome unknown" can become "it landed at version X" or "it was refused" on the next call.

## Volt's assessment (2026-10-03)

**Verdict: PARTLY.** The log-line part fits and is built. The ledger, the report frame and the pipe tag are not.

- `RelayTunnel.cs:207-211` (requests in flight are abandoned by contract) and `relay-protocol.md:137-139`: CONFIRMED.
- `RelayTunnel.cs:278-303`, the pipe call outlives the connection and only a Debug `abandoned` line records it:
  CONFIRMED, with one precision. If the connection ends first, the cancelled token makes the result's send throw
  `OperationCanceledException`, and that path gives the Debug line (`:298-303`). If the socket fails DURING the send
  while the token is still live, the generic arm logs `'push' failed on pipe …` at Error and tries to send an
  `INTERNAL_ERROR` (`:304-315`). That is a write that landed, logged as a failure; `relay-request-logging` fixes it.
- "The outcome is not logged anywhere": **WRONG in part.** `PushService` logs every push verdict at Info, with the
  items it touched, for example `push 1 ops — accepted [updated: Main.pou] (881 items) (2201ms)` at 18:51:04 in
  `codesys-2026-10-03.log`. The lines are `PushService.cs:105/117/268/326/331` in the working tree; the cited
  263 and 321 have moved because bridge-refusal-review is editing this file. So the verdict is in the log. What is
  missing is the relay id on that line and `newProjectVersion`.
- `PipeRequest` has only `op` and `body` (`PipeMessages.cs:9-13`): CONFIRMED. `BuildService.cs:58` logs the end of a
  build at Debug, and nothing logs its start: CONFIRMED.
- PLCAssist's own reading of the re-plan case is right: it is the client's. The contract is to re-send the IDENTICAL
  request.

**What does not fit, and why:**
- **The ledger and the pushed report.** They would add state to the bridge that lives across connections, and a
  bridge→relay frame kind the protocol does not have (today the bridge sends only `hello`, the ping, and frames
  tagged with an id). Every relay would have to keep tombstones. All of that delivers, late and only on the next
  connection, an answer the existing contract already gives: re-send the identical push (it applies once, or is
  refused as stale and names the items), or read.
- **A relayable `outcome {id}` query.** Same cost: state in the bridge keyed by a relay's id, plus a new op on the
  allowlist.
- **The pipe request tag and ids in engine lines.** Not needed once the tunnel's own terminal line carries the push's
  verdict and version. One line then pairs the id with the outcome, with no join by timestamp. The CLI's pipe wire
  stays unchanged.

**What fits, and is small:**
1. The terminal Info line of a request whose result could not be delivered names its outcome. For a push that is
   `accepted` or `rejected`, plus `newProjectVersion`, read from the result the tunnel already holds. This is the same
   single line format `relay-request-logging` builds (`… delivered=no`), not a second format.
2. `BuildService`'s existing end line (verdict, error and warning counts, duration) moves from Debug to Info, so a
   CLI build is in the log as well as a relayed one.

**Plan: WILL BUILD PARTLY.** Items 1 and 2 above. WILL NOT BUILD the outcome ledger, the report frame, the request tag
on `PipeRequest`, ids in engine lines, or a separate build-start line (the tunnel's `<-` line already marks the start
of a relayed build).

What PLCAssist should do instead, after "outcome unknown":
- Re-send the IDENTICAL push, with the same `expectedProjectVersion` and `ifVersion`.
- If it is accepted, the first push did not land.
- If it is refused `STALE_*`, the project moved after your base. Fetch the items it names and compare.
- Do not re-plan from a fresh read before doing this.

WHEN: built together with relay-request-logging, second of these five, in Volt's bridge lane after
bridge-refusal-review and the three earlier requests (directed-library-signatures, push-partially-applied-flag,
st-roundtrip-fixed-point).
