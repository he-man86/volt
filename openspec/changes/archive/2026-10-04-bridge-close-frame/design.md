## Decisions (bridge-close-frame)

- **Close output, not a full handshake.** `IRelaySocket.CloseOutputAsync` sends the Close frame and returns; the bridge
  does not wait for the relay's answer (a concurrent `CloseAsync` would race the receive loop's pending receive).
- **Close before cancel.** `RelayTunnel.Dispose` sends the close before it cancels the loop: cancelling a pending
  `ClientWebSocket` receive aborts the socket, and the frame would never leave. The close goes under the send lock
  (one send at a time on `ClientWebSocket`). Bounded 1 s twice: by token, and by `Wait` for a socket that ignores it.
- **TwinCAT window close** is `PosixSignal.SIGHUP` (CTRL_CLOSE_EVENT). Windows ends the process when the handler
  returns, so the handler waits (≤4 s) for the main thread's dispose.
- **CODESYS exit** is `AppDomain.ProcessExit`, measured on SP21: it fires on a normal IDE close and the frame goes out.
  The handler takes the tunnel lock-free (`Interlocked.Exchange`) so an exit never waits on the start/stop gate.
