Requires `twincat-double-click-next-free-xae` built first (same `Program.cs`, and its start class takes the console).

## 1. Tests red (offline)

- [ ] 1.1 The tee: a no-argument start (the start class, injected console) writes an Info log line to the console; a
      Debug line is not written; a `--xae-pid` start writes none.
- [ ] 1.2 TwinCAT start over an offline driver double: an attach that fails, and `Unsupported`, write no line saying the
      bridge is connected to TwinCAT; the pipe-up line states only that the pipe is up and how to stop it.
- [ ] 1.3 `RelayTunnel` (in-memory relay, injected socket and log): a socket that opens and closes with no inbound frame
      logs no `relay: connected`; the first inbound frame logs it once; a second frame does not log it again. Today: on
      socket open (`RelayTunnel.cs:250`).
- [ ] 1.4 `PipeHostTunnel.StartIfConfigured` with no sidecar and no setup code logs `relay: not configured` through
      `logInfo`. Today: silent null (`PipeHostTunnel.cs:42`).
- [ ] 1.5 CODESYS `PipeHost.Start` (offline): the returned line names the served project (or none open), the relay
      state at start (dialing `<host>` / not configured / not started) and `VoltLog.Dir`.

## 2. Implement

- [ ] 2.1 `VoltLog` console tee at Info and above, off by default; the no-argument TwinCAT start turns it on.
- [ ] 2.2 `Program.cs:155` replaced by the pipe-up line.
- [ ] 2.3 `RelayTunnel`: `relay: connected to <host>` when `_accepted` first turns true on a connection.
- [ ] 2.4 `PipeHostTunnel.StartIfConfigured`: the `not configured` line.
- [ ] 2.5 CODESYS `PipeHost.Start` line.

## 3. Live

- [ ] 3.1 TwinCAT 4024 double-click with a relay configured: the console shows the served solution, the relay's
      acceptance, and per-op `relay: <-` / `->` lines while a client works. If the per-op lines drown the rest, report
      it to the owner with the observed rate; moving them to Debug is the owner's call, not this task's.
