## Analyse first: PLCAssist may have misread this

This is a request from PLCAssist (a client of the bridge) written from the OUTSIDE: what our logs observed, and our
reading of volt's code to explain it. The observations are recorded facts. The explanation and the requested change
are our interpretation, and may be wrong — about the cause, about whether it is a gap at all, or about volt's intent.

Before any work: verify the observation, then confirm or refute our reading. If the behaviour is intended, already
covered by another route, or the gap is ours (the client using the wire wrongly), record that here with the reason and
stop — that answer is as useful to us as a fix. Only a confirmed real gap that fits volt's design goes on to the tasks.

## Why

**The bridge log cannot answer "what happened to request X" or "why did this connection end".** Relayed requests
that fail with a coded error leave only their `<-` line; the end of a connection is one line with no age, no cause
and no list of what was in flight. On 2026-10-03 PLCAssist reconstructed a session by matching timestamps across the
bridge log, the relay's logs and the app's logs by hand.

What PLCAssist sees:
- `twincat-2026-09-24.log`: `relay: <- refs (r1-0966967c)` at 21:11:03.331 and `relay: <- refs (r1-92ba4b56)` at
  21:11:18.038 have no `->` line at all. Whatever they answered is not in the log. (A `select` of the project
  follows at 21:11:53 and the next `refs` pairs, so they were most likely `PLC_DISCONNECTED` — a guess the log
  should not leave us to make.)
- No line anywhere says how long a request waited for the IDE thread versus how long it ran, which is the first
  question when a call times out (`relay-request-deadline`, `codesys-build-nesting`).

What the code shows (volt `457b6a700b`, `Volt.Relay/RelayTunnel.cs`):
- `:262` logs `<- op (id)` at Info.
- `:266-272`: an op not on the allowlist is answered `BAD_REQUEST` with no log line.
- `:292-297`: a coded pipe error (`PLC_DISCONNECTED`, `WRONG_PROJECT`, …) is forwarded with no log line — the
  unpaired ids above.
- `:298-303`: a request abandoned because the connection went is logged at Debug, without its outcome.
- `:289-290`: `-> op (id) ok` is logged only after the result frame was handed to the socket, and the pipe call and
  the send share one `try`, so a failed SEND after a successful pipe call is logged at `:312` as
  `'<op>' failed on pipe …` — a write that landed, logged as a failure.
- `:126-131`: a connection end is `relay: connection ended (<Type>): <message>` — no connection age, no in-flight
  ids, and no cause beyond the exception text. The watchdog's own line (`:348`) and the next dial (`:162`, Debug)
  are separate, so "the watchdog dropped it, 3 requests were in flight, next dial in 2 s" is three lines at best, one
  of them invisible at Info.

## Gate: only where it matches volt's design

This is what PLCAssist NEEDS, not a design handed to volt. Check it first against the log's purpose ("every close,
refusal and served op is logged there", `relay-protocol.md:233-234`), "do not log the token", log volume (a busy
session sends a `refs` and a `fetch` per tool call), and `relay-outcome-ledger` (which adds the outcome line for an
abandoned request; build one line format, not two). Implement only what fits; record what does not and the
volt-native alternative.

## What Changes

- **One terminal Info line per relayed request**, whatever ended it:
  `relay: -> <op> (<id>) <outcome> queue=<ms> run=<ms> delivered=yes|no`, where outcome is `ok`, `error <CODE>`,
  `refused <CODE>` (not relayable) or `abandoned` (connection went; with the op's own outcome when it completed).
  `queue` is the wait for the IDE thread where the host can measure it; otherwise the line gives the total.
- **The pipe outcome and the delivery are judged separately**: a send that fails after a successful pipe call is
  `ok … delivered=no`, never "failed on pipe".
- **One Info line per connection end**: its age, its cause (the relay's close code and reason, a drop without close,
  the watchdog, or a refused upgrade with its HTTP status where the platform reports it), the ids still in flight,
  and the next dial's delay.

## Impact

- `Volt.Relay/RelayTunnel.cs` (log lines only, plus timing), possibly `Volt.Engine.Host/BridgePipeHost.cs` (the queue
  wait), `docs/relay-protocol.md` (the log lines it lists).
- No wire change. PLCAssist pairs its relay's per-request record with the bridge's line by id.

## Volt's assessment (2026-10-03)

**Verdict: VALID with corrections.** The code breaks its own documented promise. `relay-protocol.md:233-234` says
"every close, refusal and served op is logged there", and today a coded refusal and a `BAD_REQUEST` are not logged at
all.

- The unpaired `refs` in `twincat-2026-09-24.log`: CONFIRMED. `r1-0966967c` (21:11:03.331) and `r1-92ba4b56`
  (21:11:18.038) have no `->` line. The `select` comes at 21:11:53.169, and the next `refs` pairs (21:11:53.682 →
  21:11:54.190). Neither side records the answer: the pipe server does not log a coded refusal either
  (`PipeServer.cs:225-238`: "a coded refusal is the caller's ordinary answer … not logged here"). `PLC_DISCONNECTED`
  is the likely answer, as PLCAssist guessed.
- `:262` `<-` at Info, `:266-272` `BAD_REQUEST` without a line, `:292-297` a coded error without a line, and
  `:298-303` abandoned at Debug: CONFIRMED.
- `:289-290` / `:312`, a failed send logged as "failed on pipe": CONFIRMED, but it is narrow. It happens only when the
  socket fails DURING the send while the token is still live. When a connection ends, the token is cancelled first,
  and the request lands in the Debug "abandoned" arm instead.
- `:126-131`, the connection-end line: CONFIRMED. **Correction:** it is logged at **Warn**, not Info, and a 1008
  refusal at Error (`:148`). The watchdog line (`:348`, Warn) and the reconnect line (`:162`, Debug) are separate:
  CONFIRMED.
- **Added by Volt:** each log file holds one SOURCE, shared by every process of that vendor, and no line carries a
  pid. In `codesys-2026-10-03.log`, the lines of a fixture IDE (37-39 items) and of the 881-item project interleave.
  The `connection ended … Unable to connect` lines at 18:50:01, 18:50:33 and 18:51:06 came while `r3-a76996ea`'s
  connection was alive (it delivered at 18:58:01), so they belong to a different tunnel, in a different process. A
  connection-end line has to name its pipe (the pipe name embeds the pid) to be readable.

**Fit: FITS.** The log stays local, nothing on the wire changes, and the token is never logged (the tunnel logs only
`SafeDescription`). Log volume barely moves: a successful request already logs `<-` and `->`, and the change adds
lines only on paths that log nothing today. Simplified:
- **The terminal line:**
  `relay: -> <op> (<id>) ok | error <CODE> | refused BAD_REQUEST | abandoned [<outcome>]  <ms>ms [delivered=no]`.
  It gives the total time only.
  - The queue/run split is **not built**. The tunnel is a pipe client, so it cannot see when the op reached the IDE
    thread without a new pipe field. And with `codesys-build-nesting`'s `IDE_BUSY`, a write no longer waits behind a
    write.
  - For an abandoned push, the outcome includes the verdict and `newProjectVersion`. That is the part of
    `relay-outcome-ledger` that gets built, in this same line format.
- **Delivery is judged apart from the pipe outcome**, so a landed push whose send failed reads `ok … delivered=no`.
- **One connection-end line**, replacing today's end line and the Debug reconnect line. It gives:
  - the pipe;
  - the connection's age;
  - the cause: the relay's close status and reason, a drop without a close (with the exception type and message,
    which names the HTTP status of a refused upgrade where the platform reports it), the watchdog, or a dead
    heartbeat;
  - the ids still in flight;
  - the delay before the next dial.

  The watchdog keeps its own Warn line as the moment it fires. The levels stay those `relay-protocol.md` documents:
  Error for a 1008 refusal, whose text is a contract; Info for a relay close; Warn for a drop.

**Plan: WILL BUILD.**
- The single terminal line for every relayed request, including the abandoned-request outcome from
  `relay-outcome-ledger`.
- The delivery outcome, separated from the pipe outcome.
- The single connection-end line, naming the pipe.
- The list of these lines in `relay-protocol.md`.

Not built: the queue-versus-run timing split. WHEN: second of these five (built together with relay-outcome-ledger's
part, after codesys-build-nesting), in Volt's bridge lane after bridge-refusal-review and the three earlier requests
(directed-library-signatures, push-partially-applied-flag, st-roundtrip-fixed-point).
