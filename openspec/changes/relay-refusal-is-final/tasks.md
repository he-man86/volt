## 1. Measure

- [x] 1.1 Today, against a fake socket that closes with 1008 `unsupported protocol 1` after `hello`: record the log
      lines and the redial cadence (expected: `socket closed by the relay`, no reason, redial at ≤ 30 s forever).
      Measured by running the group-2 tests against the unchanged tunnel: the log was `tunnel starting`,
      `connected to relay.test`, `[Info] relay: socket closed by the relay`, `[Debug] relay: reconnecting in 1s`,
      with no status, no reason and no error line. The redial took the ordinary cadence (1, 2, 4, 8, 16, 30 s…; a
      1008 as the fourth end waited 8.7 s). The backoff also never reset (see proposal, "Found during
      implementation").
- [x] 1.2 Confirm `docs/relay-protocol.md` is absent and `RelayTunnel.cs:13` references it. Confirmed; so did
      `Volt.Relay.csproj:6`.
- [x] 1.3 Against the PLC Assist relay: how is a revoked/bad token refused — HTTP 401 at the upgrade, or a 1008
      close after `hello`? Record it in the doc; only a 1008 is in scope.
      Answered from PLC Assist's CODE, not measured live: 401 at the upgrade (`volt-routes.ts:181-183`); its only
      1008 is `unsupported protocol N` (`volt-relay.ts:333`). Recorded in `relay-protocol.md`, "One relay, read
      from its code".

## 2. Tests red

- [x] 2.1 `RelayTunnelTests`: 1008 + reason after `hello` → one error log containing the reason and the update hint;
      the next dial waits the long ceiling, not 30 s (inject the clock/delay; no real waiting).
      (Plus: a 1008 for another reason names it WITHOUT the update hint.)
- [x] 2.2 1006 and 1001 → the 30 s ceiling, today's behaviour pinned. (Green before and after: it is the pin.)
- [x] 2.3 1008 then an accepted connection → backoff back at the floor.
- [x] 2.4 Every relay close logs its status and description (not only 1008).
- [x] 2.5 The local pipe keeps answering while the tunnel is refused. (Green before and after: the pipe host never
      depended on the tunnel.)

## 3. Implement

- [x] 3.1 `IRelaySocket`: report the close status and description with the close (the real adapter reads
      `ClientWebSocket.CloseStatus` / `CloseStatusDescription`).
- [x] 3.2 Receive loop: surface a relay close as an outcome carrying status + reason.
- [x] 3.3 `RunForeverAsync`: 1008 → error log + long ceiling (1 h); anything else → today's path.
- [x] 3.4 Restore `docs/relay-protocol.md` from `7e262f7338`, reconcile it with today's code, add the close rules.

## 4. Verify

- [ ] 4.1 Against a relay that refuses the protocol: one attempt, the error line in the bridge log, the next attempt
      an hour later, the local pipe answering throughout.
      BLOCKED: no relay is reachable from here without inventing credentials, and Volt runs none. The same
      behaviour is covered against the in-memory relay (group 2); the live check is still owed.
- [ ] 4.2 A relay restart mid-session still reconnects within 30 s.
      BLOCKED: same reason as 4.1.
