## 1. Measure

- [ ] 1.1 Today, against a fake socket that closes with 1008 `unsupported protocol 1` after `hello`: record the log
      lines and the redial cadence (expected: `socket closed by the relay`, no reason, redial at ≤ 30 s forever).
- [ ] 1.2 Confirm `docs/relay-protocol.md` is absent and `RelayTunnel.cs:13` references it.
- [ ] 1.3 Against the PLC Assist relay: how is a revoked/bad token refused — HTTP 401 at the upgrade, or a 1008
      close after `hello`? Record it in the doc; only a 1008 is in scope.

## 2. Tests red

- [ ] 2.1 `RelayTunnelTests`: 1008 + reason after `hello` → one error log containing the reason and the update hint;
      the next dial waits the long ceiling, not 30 s (inject the clock/delay; no real waiting).
- [ ] 2.2 1006 and 1001 → the 30 s ceiling, today's behaviour pinned.
- [ ] 2.3 1008 then an accepted connection → backoff back at the floor.
- [ ] 2.4 Every relay close logs its status and description (not only 1008).
- [ ] 2.5 The local pipe keeps answering while the tunnel is refused.

## 3. Implement

- [ ] 3.1 `IRelaySocket`: report the close status and description with the close (the real adapter reads
      `ClientWebSocket.CloseStatus` / `CloseStatusDescription`).
- [ ] 3.2 Receive loop: surface a relay close as an outcome carrying status + reason.
- [ ] 3.3 `RunForeverAsync`: 1008 → error log + long ceiling (1 h); anything else → today's path.
- [ ] 3.4 Restore `docs/relay-protocol.md` from `7e262f7338`, reconcile it with today's code, add the close rules.

## 4. Verify

- [ ] 4.1 Against a relay that refuses the protocol: one attempt, the error line in the bridge log, the next attempt
      an hour later, the local pipe answering throughout.
- [ ] 4.2 A relay restart mid-session still reconnects within 30 s.
