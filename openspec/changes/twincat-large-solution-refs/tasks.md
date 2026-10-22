## 1. refs speed on large solutions
- [x] 1.1 Reproduce with an 18-PLC-project solution; measure walk vs materialize — a templated 18-project fixture did not
      load cleanly in XAE and the owner stopped it; growth measured offline instead (`TcLargeSolutionGrowthTests`: every
      COM read of `refs`/`fetch` is N × its count at one PLC project, N = 1, 3, 10, 18, as N system projects of one PLC
      project each and as one system project of N), and every `refs` now logs its
      own breakdown (`refs: N items in T ms — walk …, materialize …`) so the customer's next run gives the real one
- [x] 1.2 Progress frames during the walk (`phase: "walking"`, one per PLC project) and the item frames as before
- [x] 1.3 Single-flight `refs` (an identical `refs` joins the running one; not a cache)
- [x] 1.4 The relay heartbeat holds no pool thread: each relayed pipe call runs on a thread of its own (measured: one ping
      in 1.5 s at a 100 ms cadence with retried refs held, before)
- [x] 1.5 Speed: the Solution Explorer read for the PLC subtree only, the solution's hierarchies enumerated once per
      operation (was O(n²)), the declarations index from the operation's own walk
- [x] 1.6 Measure on the owner's hand-built fixture (C:\Users\marce\Documents\TwinCAT Large18, served as a copy): it holds
      16 system projects but 4 PLC projects (12 are empty), so a copy with Project1's PLC project in each empty one was
      measured too (18 PLC projects, 154 items). refs and fetch answer byte-identical JSON before and after on both.
      4 PLC: refs 385 → 297 ms warm (1.7 → 1.0 s cold). 18 PLC: refs median 1.56 → 1.08 s, fetch 1.76 → 1.23 s (8 runs
      each, interleaved); after: walk ~460 ms (Solution Explorer ~260 ms over 16 system projects), materialize ~490 ms
      (compiler settings ~200 ms, 11 ms a PLC project). On this shape a PLC project costs ~50 ms; the customer's 148 s
      (~8 s a PLC project) is content this fixture does not have (its I/O and instance trees, which the Solution Explorer
      no longer reads, or many more items): their `refs:` log line will say which
- [x] 1.7 Answer PLC Assist in proposal.md: speed or progress (decides their refs budget)

## 2. UInt32 OverflowException in refs
- [x] 2.1 Locate the throw — `TcSolutionExplorer.ItemId`'s checked conversion throws exactly this on a negative `Int64`
      or `Int16` item id, but a throw there surfaces as `ITEM_UNVERIFIED` ("the Solution Explorer hierarchy is
      unreadable"), not `INTERNAL_ERROR`: the reported one came from a call the walk does not catch. The bridge log's
      stack is still needed; a failing `refs` now also logs what it was doing
- [x] 2.2 Fix `ItemId` (every integer VARIANT read as its DWORD, test-first); no state outlives an operation (the
      declarations and the walk index are dropped at every operation's start)

## 3. LinkAlways GVLs
- [x] 3.1 Measure `<LinkAlways>` as a TwinCAT item property (as on CODESYS)
- [x] 3.2 Round-trip test: pull + push a LinkAlways GVL keeps the property

## 4. Gates
- [x] 4.1 C# suites (Engine 3080, Cli 333, Contracts 42, Repo.Gates 242, Ide.Codesys 471, Ide.Twincat 708, Connector 153,
      Relay 72), volt-cli `bun test test/unit` (174), root typecheck / lint / check: all green
- [x] 4.2 Full e2e: CODESYS 3.5.21.40 360 pass 0 fail; TwinCAT MultiProject 359 pass 1 fail — the disconnect-cycle
      in-flight test, a timed 750 ms race in the test itself (it lost the race under load), then 9/9 on three reruns
