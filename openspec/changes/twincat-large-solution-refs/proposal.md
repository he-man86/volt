> PLC Assist, 2026-10-21. Production finding on 0.1.17931 (TwinCAT 3.1.4024.75, TcXaeShell 15.0). A customer's
> solution with 18 PLC projects cannot be used at all; the same customer's 3- and 10-project solutions work.
> Evidence: chats f2893463, bb8c9763, 5e642a1c, 5282b30e, c041d7b7, 11a67131 (2026-10-21 03:11–06:44 UTC) and the
> customer's bridge console screenshot.

## Why

Three separate defects show up on one large TwinCAT solution. Together they leave the user with no read, no build
and no list. PLC Assist cannot work around any of them: they happen inside the bridge.

## What Changes

### 1. `refs` on an 18-project solution takes ~148 s (must fit the relay budget)

Bridge log: `relay: -> refs (r-825939b5) ok 148442ms`. PLC Assist sends `refs` with the default 60 s relay budget, so
the relay answers `RELAY_TIMEOUT` (progressCount 0) and drops the late result. Each retry by the AI starts another
full `refs`, which queues behind the one still running in the IDE. While it runs the bridge stops answering pings
("silent for 24s"); `health` still answers in 3–8 ms.

`refs` is the first call of every turn (`plcGlob`; `plcBuild` sends it to get the project identity). On this solution,
nothing works.

Asked of Volt:
- Make `refs` fast on large solutions: an index kept between calls and invalidated on change, not a full walk per
  call. A target such as < 10 s at 18 PLC projects.
- Or send progress frames during `refs`, so a client can tell "working" from "hung". `progressCount` was 0.
- Say which part of the 148 s is the walk and which is materialize (the log shows materialize warnings just before
  the answer).

> Volt (2026-10-21): BOTH, in this order.
> 1. Progress frames during `refs` (per PLC project walked and per item materialized), so the relay sees work; raise
>    your `refs` budget to 240 s as you offered. This ships first: it makes the solution usable.
> 2. One `refs` at a time: a `refs` that arrives while one is running joins it and gets the same answer (single-flight),
>    so an abandoned call's retries no longer stack in the IDE. Relay pings are answered while a `refs` runs.
> 3. Speed, measured: we build an 18-PLC-project fixture, split the 148 s into walk / Explorer hierarchy / materialize per
>    PLC project, and fix what grows faster than the item count (the 3- and 10-project solutions working while 18 does
>    not points at that). Two measured savings are already queued (the declarations index from the op's own walk, the
>    Explorer hierarchy read for the PLC subtree only, ~25% on our fixture).
> An index kept BETWEEN calls (answering from a cache) is not planned: Volt's owner ruled out caching across operations
> for now (answering from stale state is the risk). If the measured fixes do not reach the budget, that is raised with
> the owner with the numbers.

### 2. `refs` fails with `OverflowException: Value was either too large or too small for a UInt32.`

After the timeouts above, every `refs` answered within ~0.8–1.2 s with `INTERNAL_ERROR`, bridge message
`OverflowException: Value was either too large or too small for a UInt32.` (relayIds r-46a6f6d5, r-4fd67b20,
r-bda4dce5, r-1bafec43, r-5b3e2739, r-991cd614, 03:42–03:43 UTC). Later sessions went back to timing out, so this
looks like a state left behind by the abandoned `refs` calls (a counter, an index, a COM value), not the project
content.

Asked of Volt: the stack trace, and a fix. A `refs` must never fail because an earlier call was abandoned.

> Volt (2026-10-21): a strong candidate, not yet proven: the Explorer hierarchy read converts each item id with a checked
> `Convert.ToUInt32` (`TcSolutionExplorer.ItemId`), which throws exactly this message for a negative or out-of-range
> value. We reproduce it on the 18-project fixture, fix it test-first, and make sure no state from an abandoned call can
> fail a later one. If you have the bridge log of 03:42 UTC (the stack trace is in it), please attach it here.

### 3. GVLs with `<LinkAlways>` in the `.plcproj` are not pulled

```
[twincat][warn] materialize failed name='PLC-SA11/PLC/PLC-SA11/PLC-SA11 Project/GVLs/G_EPICS.gvl' - body skipped
from pull: 'G_EPICS' (G_EPICS.TcGVL): its .plcproj entry holds <LinkAlways> - a build property TwinCAT has no
measured member for in Volt's text, so the object is not pulled.
```

Same for `G_IO.gvl` in PLC-SA11 and PLC-SA15. `<LinkAlways>` is the TwinCAT default for GVLs created from I/O mapping
and library templates. Typical projects have many of them, and they hold the I/O variables everything else
references. Skipping them leaves the AI blind to the variables the program is about.

Asked of Volt: carry `LinkAlways` as a measured property (the CODESYS side already has a LinkAlways member in
`ObjectProperties` / `PropertyLines`), so the object is pulled and a write round-trips it.

> Volt (2026-10-21): yes. TwinCAT publishes `LinkAlways` live (the same VSProperty route the exclude-from-build fix of
> 0.1.17931 reads), so it is read live and pulled as `%LINK_ALWAYS`, byte-identical to CODESYS, and a push writes it back.
> The other `.plcproj` build properties (`External`, item compiler defines) move to the live read in the same change.

## Impact on PLC Assist

- No wire change is expected. PLC Assist needs only the fixed bridge. The protocol stays 1.
- If (1) is solved by progress frames rather than speed, PLC Assist will raise its `refs` budget to the same 240 s
  it gives `build`. Tell us which way.
