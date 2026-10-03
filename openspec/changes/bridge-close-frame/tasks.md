## 0. Design gate — do this first

- [x] 0.1 (volt, 2026-10-03: confirmed, FITS. One reason, `bridge stopping`, and status 1001. The connector's process kill and a crash stay 1006. The CODESYS exit hook must be measured on SP21. See the proposal's assessment.) Verify the observation and confirm or refute PLCAssist's reading (see "Analyse first"): that every bridge
      stop path ends in `Abort()` or in process death, and that closing the TwinCAT console window never runs the
      tunnel's dispose. If refuted or intended, record why and stop. Then check the request against volt's design
      (1008 semantics, the watchdog's Abort, what CODESYS allows an in-proc plugin on exit, never hanging a closing
      IDE). Record FITS, or CONFLICTS + why + the volt-native alternative. Build only what fits.
- [x] 0.2 (decided: status 1001, the single reason `bridge stopping`, and a bound of about 1 s, then Abort.) Decide the close reasons and the bound on the close wait.

## 1. Test red

- [ ] 1.1 Tunnel test (in-memory socket): `Dispose` sends a Close 1001 with the reason, then drops; a socket that
      never completes the close is dropped within the bound.
- [ ] 1.2 Tunnel test: the watchdog path still aborts without a Close.

## 2. Build

- [ ] 2.1 The bounded close on `IRelaySocket` and in `Dispose`; the TwinCAT console-close handler; the CODESYS exit
      hook; `relay-protocol.md`.

## 3. Verify

- [ ] 3.1 Live, against a relay that logs closes: close the TwinCAT console window, exit CODESYS, run the stop script;
      each shows 1001 and its reason at the relay. Kill the network instead; the relay still sees 1006.
- [ ] 3.2 Full C# suites and `bun run check` green.
