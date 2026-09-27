## Why

**A bridge the relay refuses keeps dialing every 30 s and never says why.** The relay closes a bridge it will not
serve with WebSocket close status 1008 and a reason — `unsupported protocol N` for a bridge from another protocol
version (PLC Assist's `infra/relay-worker/src/volt-relay.ts`). In Volt:

- `IRelaySocket.ReceiveTextAsync` returns `null` on a close and **drops the close status and description**
  (`packages/volt-cli/src/Volt.Relay/IRelaySocket.cs`). The tunnel logs only `relay: socket closed by the relay`.
- `RelayTunnel.RunForeverAsync` treats every end the same: jittered backoff from 1 s doubling to a 30 s ceiling
  (`BackoffFloor`/`BackoffCeiling`), then redial, indefinitely.

So "this bridge is too old, download the new one" looks, on the machine running it, exactly like a network blip.
PLC Assist now forces updates, which makes a stale bridge a normal event, and a protocol bump would strand every old
install this way.

## What Changes

- **The close is not thrown away.** The socket abstraction reports the close status and description; the tunnel
  logs every relay close with both.
- **A policy refusal is an error with an action.** On 1008 the tunnel logs at error level: the relay refused this
  bridge (`<reason>`), and when the reason names the protocol, that the latest bridge must be downloaded.
- **A policy refusal slows dialing; it does not end it.** After a 1008 the tunnel backs off to a long ceiling
  (1 hour) instead of 30 s. It is NOT final for the process, because:
  - the CODESYS bridge runs IN-PROC in `CODESYS.exe` — "restart the bridge" means restarting the engineer's IDE;
  - one mistaken 1008 from a relay deploy would otherwise disconnect every bridge until each user restarts;
  - the existing design already chose backoff over giving up for a refusing relay (the comment in
    `RunForeverAsync`: an immediate redial "against a relay that is refusing (a revoked token, say) is a hot loop
    against someone else's server").
  A connection that is accepted again resets the backoff to the floor, as today.
- **Other ends are unchanged.** Network errors, relay restarts (1001/1006) and normal closes keep the 30 s ceiling.
  A refused tunnel never stops the bridge serving its local pipe.
- **The protocol doc is restored.** `RelayTunnel.cs:13` points at `packages/volt-cli/docs/relay-protocol.md`, which
  the revert `f5963cca40` deleted and `84bbc054ff` did not bring back. Restore it from `7e262f7338`, check it against
  today's code, and record the close-status rules there.

## Review 2026-09-27 (checked against the code)

- Confirmed: the dropped close reason, the unconditional 30 s redial, the missing log line.
- Changed: "final for the process" → long backoff (reasons above).
- Found: `docs/relay-protocol.md` does not exist; the original task 2.4 edited a missing file.
- Unverified: that a refused CREDENTIAL arrives as a 1008 close. A bad bearer token normally fails the HTTP upgrade
  (401) inside `ConnectAsync`, which throws and never reaches the close path. Measure against the PLC Assist relay
  before claiming it (task 1.3); if it is a 401, it is logged as today and is out of scope here.

## Non-goals

- No protocol negotiation, and no change to what the relay refuses.
- No UI in the bridge; the log is the surface, as for every other tunnel fault.

## Impact

- `packages/volt-cli/src/Volt.Relay/IRelaySocket.cs` (close status/description), `RelayTunnel.cs` (receive loop
  outcome, backoff ceiling after 1008, log lines).
- `packages/volt-cli/test/Volt.Relay.Tests/RelayTunnelTests.cs`.
- `packages/volt-cli/docs/relay-protocol.md` (restored).
