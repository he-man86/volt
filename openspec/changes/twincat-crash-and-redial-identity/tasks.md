# Tasks

## 1. TwinCAT crash under refs
- [ ] 1.1 Read the walk at `TwinCAT Project14/PLC/Untitled2/Untitled2 Project/DUTs` after the C2i "not opened"
      handling: any COM object used after its parent was released?
- [ ] 1.2 Soak: `refs` on the MultiProject fixture N times, and right after a forced relay reconnect.
- [ ] 1.3 The worker logs the last COM call before an RPC failure (0x800706BA / 0x800706BE).

## 2. Redial identity
- [x] 2.1 Answered without a wire change: the relay decides from `hello.pipe` (owner, 2026-10-27). `pipe` is fixed for
      the tunnel's life and unique per process on one machine; a cross-machine pid collision is accepted and logged
      by the relay (`bridge_pipe_collision`).
- [x] 2.2 Nothing to name: PLC Assist's `relay-redial-same-instance` accepts the redial, decides at `hello` (same
      vendor + pipe → replace the incumbent; different, or no hello in time → close 1013 before any frame).
- [x] 2.3 Not needed (owner, 2026-10-27).
