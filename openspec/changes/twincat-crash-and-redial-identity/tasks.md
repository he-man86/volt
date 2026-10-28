# Tasks

## 1. TwinCAT crash under refs
- [x] 1.1 Read the walk at `TwinCAT Project14/PLC/Untitled2/Untitled2 Project/DUTs` after the C2i "not opened"
      handling: any COM object used after its parent was released? **Nothing provably wrong (2026-10-28).** No COM
      handle is released on the walk path: the only `ReleaseComObject` calls (`DropPlcs`, `DropProject`, `SwapDte`,
      `ReleaseDte`, `ReadBuild`'s remote manager) run on select/recovery/health, never inside an op, and the STA queue
      (`StaDispatcher`, a `BlockingCollection`, not window messages) cannot re-enter one op's work into another's COM
      call. No RCW outlives its op: the snapshot, the PLC root, the declarations and the walk index are dropped at every
      op's start (`MarshalToIdeThread`); only the TIPC child (`TcPlc.Node`) and the managers live across ops, as DIALECT
      C2i records. **But the fault is C2i's own:** `TwinCAT System Manager.dll` 3.1.0.4384, `0xc0000005` at `0x00bcc7e8`
      is byte-for-byte the crash C2i measured when a POU the IDE does not read as a POU is opened after a load, and the
      snapshot had just flagged such POUs in `Untitled2 Project`. The call in flight (`0x800706BE`) was `ChildAt(1)` in
      `DUTs` — after `ChildCount`/`Exclusion` on the folder returned, so `Child[1]`/`LookupChild` opening its first
      child — i.e. a C2i touch the guard did not prevent, or a crash asynchronous to it. Unmeasured routes that 1.2
      must settle: a POU loaded broken whose caption has since healed (flagged only while this worker saw it bare: a
      worker restart forgets `_flaggedThisSession`); a bare-captioned POU `LookupTreeItem` resolves although it was not
      written in this load (an archive import — move / member placement — of such text); `ProduceXml(false)` on the
      folder holding one (the walk's C39 exclusion read, added after C2i's live check).
- [ ] 1.2 Soak: `refs` on the MultiProject fixture N times, and right after a forced relay reconnect.
- [x] 1.3 The worker logs the last COM call before an RPC failure (0x800706BA / 0x800706BE). The walk's COM calls go
      through one funnel, `BeckhoffDriver.Touch` (BeckhoffDriver.Tree.cs), each named with the wire path it touches; at
      a walk's FIRST RPC failure it logs `walk: RPC failure 0x800706BE on ChildAt(1) at '<path>'; the last COM call
      that returned: <call> at '<path>'` (the classifier is the one `RpcFault`/`IsRpcFault`). Pinned offline:
      `TcWalkRpcTrailTests` (2). Suites: Twincat 729/729, Engine 2437 + 1 skipped, Repo.Gates 276/276.

## 2. Redial identity
- [x] 2.1 Answered without a wire change: the relay decides from `hello.pipe` (owner, 2026-10-27). `pipe` is fixed for
      the tunnel's life and unique per process on one machine; a cross-machine pid collision is accepted and logged
      by the relay (`bridge_pipe_collision`).
- [x] 2.2 Nothing to name: PLC Assist's `relay-redial-same-instance` accepts the redial, decides at `hello` (same
      vendor + pipe → replace the incumbent; different, or no hello in time → close 1013 before any frame).
- [x] 2.3 Not needed (owner, 2026-10-27).
