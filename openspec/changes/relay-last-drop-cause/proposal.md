> 2026-11-05: a drop on the dev machine during a gate run, 19:31:19 ("dropped without a close" after 1290 s, back in 1.7 s); the bridge log is kept, the relay's side is only in Cloudflare and needs the owner's login before retention ends.

## Why

One customer's bridge drops far more often than any other (153 closes in 3.5 days, 143 of them 1006 with no Close frame), and
calls fail. The customer cannot be asked for anything (owner, 2026-11-05), and the relay logs cannot say why a connection ended:
only the bridge knows, and its log stays on the customer's machine.

What is known, 2 to 5 Nov, CODESYS 3.5.21.40, bridge 0.1.18312:

- A healthy fetch takes 1.4 s (median of 401). Failures are not slow transfers.
- Reproduced with a fault proxy on the real tunnel (`test/shared/RelayFaultTests.cs`): a two-way blackhole, an upstream-only one,
  a blackhole after 16 KB, an RST and latency with pauses do not match the logs. Downstream-only death (relay to bridge dead) is
  the one fault that gives 1006 at last ping age 25.0 s, the logged cluster, and it spares answers under the 16 KiB window.
- Three facts it does not explain: failures at 46 s (no bridge timer fires before 60 s), the redial landing while the relay
  still holds the old socket (83 of 89), and the relay's 60 s chunk stall never firing. A rival explanation, not measurable with
  a proxy: the bridge's own TCP giving up on retransmits.
- PLC Assist's ride-through already retries reads: of 45 calls, 24 recovered and 21 failed, 18 of those because the bridge was
  not back within its 15 s wait. When it does return it takes a median of 5 s, up to 12.5 s; the clock starts when the relay reports
  the failure, so this cannot separate a slow dial from a late abort.

## What Changes

- The bridge's `hello` carries `lastDrop`: `{cause, ageS, silentS, inFlight, dialMs}`, the cause a fixed token
  (`watchdog_silence`, `send_stalled`, `chunk_unacked`, `no_close:<ExceptionType>`, `dial_timeout`), never exception text, which is
  localized. `dialMs` is what the redial took. Protocol stays 1: the relay ignores an unknown hello member (read in its `onHello`).
- PLC Assist adds the field to its `hello` log line and deploys. Its owner's decision.
- Ships with the next bridge release, not alone: a new bridge makes every customer re-download.

## Not in this change

- Shorter limits (ping 10 s, silence 25 s). Measured: a failure ends at +26 s, not +65 s, and 2 KB/s still passes, but a 25 s pause
  becomes a drop and the link floor rises to about 655 B/s. Decide on real causes.
- A shorter dial bound or a longer ride-through wait: same reason.

## Impact

`packages/volt-cli/src/Volt.Relay/RelayFrames.cs`, `RelayTunnel.cs`, `docs/relay-protocol.md`, and the test pinning hello's members.
