## Analyse first: PLCAssist may have misread this

This is a request from PLCAssist (a client of the bridge) written from the OUTSIDE: what our relay observed, and our
reading of volt's code to explain it. The observations are recorded facts. The explanation and the requested change
are our interpretation, and may be wrong — about the cause, about whether it is a gap at all, or about volt's intent.

Before any work: verify the observation, then confirm or refute our reading. If the behaviour is intended, already
covered by another route, or the gap is ours (the client using the wire wrongly), record that here with the reason and
stop — that answer is as useful to us as a fix. Only a confirmed real gap that fits volt's design goes on to the tasks.

## Why

**A bridge that stops on purpose looks exactly like a Cloudflare platform drop: the relay sees 1006, no Close frame.**
PLCAssist counts platform drops to know how often a write's outcome becomes unknown, and every IDE exit pollutes that
count. It also means the relay cannot tell a user "your IDE was closed" from "the connection blinked, it will be back".

What PLCAssist sees (relay Workers logs, 7 days to 2026-10-03): the bridge sockets' closes are 1006 /
`wasClean:false`; the only clean closes (1001, 1005) are browser subscriber sockets. Nothing in them separates an
engineer closing the IDE or the TwinCAT console from a platform restart. PLCAssist's relay now answers a Close frame
cleanly (PLCAssist commit `d72f3a9c`), but there is none to answer.

What the code shows (volt `457b6a700b`):
- `RelayTunnel.Dispose` (`Volt.Relay/RelayTunnel.cs:386-394`) cancels and calls `socket.Abort()`. `IRelaySocket`
  (`Volt.Relay/IRelaySocket.cs:18-29`) has no close method at all; `Abort` is documented as "without a close
  handshake", which is right for the watchdog and wrong for a deliberate stop.
- `relay-protocol.md:133-135` and the close table (`:146-151`) describe only closes the RELAY sends.
- TwinCAT (`Volt.Ide.Twincat/Program.cs:373-380`): `Console.CancelKeyPress` is the only handled path. Closing the
  console window (the documented way to stop the bridge, `:356-359`) ends the process group, so the `using var
  tunnel` never disposes — not even the Abort runs; the socket dies with the process.
- CODESYS (`Volt.Ide.Codesys/PipeHost.cs:180-186`): the tunnel is disposed only from `Stop()`, which only
  `stop_volt_codesys.py` calls. We found no IDE-exit hook (`ProcessExit`, `DomainUnload`) in `Volt.Ide.Codesys`, so an
  IDE exit also ends without a close.

## Gate: only where it matches volt's design

This is what PLCAssist NEEDS, not a design handed to volt. Check it first against: "1008 only for what a redial cannot
change" (a stop must not use 1008), the watchdog's deliberate Abort (a dead peer gets no handshake), the CODESYS
in-proc constraints (what the IDE lets a plugin do on exit, and how long), and that a stop must never hang an IDE
that is closing. Implement only what fits; record what does not and the volt-native alternative.

## What Changes

- **A deliberate stop sends a Close frame** before dropping the socket: status 1001 (going away) with a reason that
  says which stop it is, for example `bridge stopping` (stop script, Ctrl+C) or `ide exiting`. Bounded: at most about
  1 s waiting for the close to go out, then Abort as today.
- **TwinCAT handles the console window closing** (the console control handler's close event), not only Ctrl+C, and
  disposes the tunnel there.
- **CODESYS disposes the tunnel when the IDE exits**, through whatever exit hook the in-proc host can use.
- The watchdog and the heartbeat failure keep their Abort (no handshake with a peer that stopped answering).
- `relay-protocol.md` documents the bridge's own closes beside the relay's.

## Impact

- `Volt.Relay/IRelaySocket.cs` (a bounded close), `Volt.Relay/RelayTunnel.cs` (`Dispose`), `Volt.Ide.Twincat/Program.cs`,
  `Volt.Ide.Codesys/PipeHost.cs`, `docs/relay-protocol.md`.
- Relays: PLCAssist's relay logs the close code and `wasClean` per bridge socket, counts 1001 as a user stop, and can
  show "the IDE was closed" instead of "reconnecting".

## Volt's assessment (2026-10-03)

**Verdict: VALID with corrections.** Every citation was checked against `dev`; none of the cited files changed since
`457b6a700b`.

- `RelayTunnel.Dispose` cancels, then `socket.Abort()` (`RelayTunnel.cs:386-394`): CONFIRMED. `IRelaySocket` has no
  close method, and `Abort` is documented as "without a close handshake" (`IRelaySocket.cs:18-29`): CONFIRMED.
- `relay-protocol.md:133-135` and the close table (`:146-151`) describe only closes the relay sends: CONFIRMED.
- TwinCAT, `Console.CancelKeyPress` is the only handled path (`Program.cs:373-380`), and closing the window ends the
  process without the dispose: CONFIRMED. **Correction:** Ctrl+C does reach the dispose (`done.Wait()` returns, and
  `using var tunnel` disposes), but the dispose Aborts, so the relay still sees 1006. **Missing case:** when the
  connector stops a worker it supervises, it kills the process tree (`Volt.Connector.Core/BridgeSupervisor.cs:117`,
  `Process.Kill`). Code cannot run in a killed process, so that stop stays 1006 whatever this change does. A crash
  also stays 1006.
- CODESYS, the tunnel is disposed only from `PipeHost.Stop()` (`PipeHost.cs:179-187`), which only
  `stop_volt_codesys.py` calls. `Volt.Ide.Codesys` has no `ProcessExit`/`DomainUnload` hook: CONFIRMED.

**Gap and fit: a real gap, and it FITS.** Status 1001 means "going away". 1008 stays the relay's "retrying will not
help". The watchdog and a failed heartbeat keep their Abort. The relay already fails the requests in flight whenever
a socket ends ("exactly one terminal frame, or the socket closes"), so a clean close changes nothing about requests.
The limits:
- The wait is bounded (about 1 s, then Abort as today), so a stop never holds up an IDE that is closing.
- The CODESYS exit hook is a vendor fact, and has to be MEASURED on SP21. On .NET Framework, all `ProcessExit`
  handlers together get about 2 s by default, so a 1 s close fits. Nobody has measured whether CODESYS's shutdown
  reaches that hook while the socket can still send.
- On net10, TwinCAT's console window close (CTRL_CLOSE_EVENT) can be caught through `PosixSignalRegistration`, where
  SIGHUP maps to it on Windows. Measure this too.

**Simplification:** one reason for every deliberate stop: 1001 `bridge stopping`. A relay needs to tell "stopped on
purpose" from "dropped". It does not need to know which button stopped the bridge, so a separate `ide exiting`
reason gives it nothing to act on.

**Plan: WILL BUILD.**
- `IRelaySocket` gets a bounded close. `RelayTunnel.Dispose` sends Close 1001 `bridge stopping`, waits at most about
  1 s, then Aborts as today.
- TwinCAT disposes the tunnel when its console window is closed, as well as on Ctrl+C.
- CODESYS disposes the tunnel when the IDE exits, through a hook measured on SP21. If no hook is reachable in time,
  an IDE exit stays 1006 and the docs say so.
- `relay-protocol.md` documents the bridge's own closes, and says that a connector-stopped TwinCAT worker and a crash
  stay 1006.

Not built: a different reason for each kind of stop. WHEN: in Volt's bridge lane after bridge-refusal-review and the
three earlier requests (directed-library-signatures, push-partially-applied-flag, st-roundtrip-fixed-point). It is
third of these five, after codesys-build-nesting and relay-request-logging (which also carries the part of
relay-outcome-ledger that gets built).
