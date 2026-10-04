## 0. Design gate — do this first

- [x] 0.1 (volt, 2026-10-03: confirmed, FITS. One reason, `bridge stopping`, and status 1001. The connector's process kill and a crash stay 1006. The CODESYS exit hook must be measured on SP21. See the proposal's assessment.) Verify the observation and confirm or refute PLCAssist's reading (see "Analyse first"): that every bridge
      stop path ends in `Abort()` or in process death, and that closing the TwinCAT console window never runs the
      tunnel's dispose. If refuted or intended, record why and stop. Then check the request against volt's design
      (1008 semantics, the watchdog's Abort, what CODESYS allows an in-proc plugin on exit, never hanging a closing
      IDE). Record FITS, or CONFLICTS + why + the volt-native alternative. Build only what fits.
- [x] 0.2 (decided: status 1001, the single reason `bridge stopping`, and a bound of about 1 s, then Abort.) Decide the close reasons and the bound on the close wait.

## 1. Test red

- [x] 1.1 (`A_deliberate_stop_sends_close_1001_bridge_stopping_then_drops`, `A_close_the_relay_never_takes_is_dropped_within_the_bound`; red before 2.1) Tunnel test (in-memory socket): `Dispose` sends a Close 1001 with the reason, then drops; a socket that
      never completes the close is dropped within the bound.
- [x] 1.2 (`The_watchdog_still_aborts_without_a_close`) Tunnel test: the watchdog path still aborts without a Close.

## 2. Build

- [x] 2.1 (`IRelaySocket.CloseOutputAsync`; `Dispose` sends the close under the send lock BEFORE cancelling — a cancelled ClientWebSocket receive aborts the socket — bounded 1 s by token and by Wait; TwinCAT: `PosixSignalRegistration` SIGHUP = CTRL_CLOSE_EVENT, the handler waits for the dispose since Windows ends the process when it returns; CODESYS: `AppDomain.ProcessExit`, lock-free) The bounded close on `IRelaySocket` and in `Dispose`; the TwinCAT console-close handler; the CODESYS exit
      hook; `relay-protocol.md`.

## 3. Verify

- [x] 3.1 (2026-10-04, a local Bun relay logging closes; the real ClientWebSocket. TwinCAT worker in its own conhost (a bogus `--xae-pid`, degraded — the tunnel needs no XAE): WM_CLOSE on the console window -> `1001 "bridge stopping"`, the process gone in 49 ms; Ctrl+C (GenerateConsoleCtrlEvent) -> 1001; hard kill -> 1006. CODESYS SP21 fixture instance bridge-close-frame: IDE exit (ide.ps1 down, CloseMainWindow) -> ProcessExit fired, `CODESYS exiting (pid 35052) — closing the relay tunnel`, relay 1001 at the same ms; the shipped `stop_volt_codesys.py` run in-IDE -> 1001. "Kill the network" measured as a process kill, which the relay sees as 1006.) Live, against a relay that logs closes: close the TwinCAT console window, exit CODESYS, run the stop script;
      each shows 1001 and its reason at the relay. Kill the network instead; the relay still sees 1006.
- [x] 3.2 (2026-10-04: Relay 62, Contracts 39, Connector 115, Codesys 305, Repo.Gates 136, Cli 262, Engine 2283+1 skipped, TwinCAT 449; `bun run check` 18/0; typecheck green) Full C# suites and `bun run check` green.
