## Analyse first: PLCAssist may have misread this

This is a request from PLCAssist (a client of the bridge) written from the OUTSIDE: what our logs observed, and our
reading of volt's code to explain it. The observations are recorded facts. The explanation and the requested change
are our interpretation, and may be wrong — about the cause, about whether it is a gap at all, or about volt's intent.

Before any work: verify the observation, then confirm or refute our reading. If the behaviour is intended, already
covered by another route, or the gap is ours (the client using the wire wrongly), record that here with the reason and
stop — that answer is as useful to us as a fix. Only a confirmed real gap that fits volt's design goes on to the tasks.

## Why

**On CODESYS, relayed ops run inside a running build instead of after it: builds finish in reverse order, and a read
answers in the middle of a compile.** `relay-protocol.md:121-123` says "everything else takes the IDE and queues
behind it"; on CODESYS the log shows it does not.

What PLCAssist sees (CODESYS bridge, volt `457b6a700b`, log `codesys-2026-10-03.log`, one project, one IDE):

| received | id | answered |
| --- | --- | --- |
| 18:51:05.980 | build `r3-a76996ea` | 18:58:01.103 (last) |
| 18:52:51.891 | build `r1-5deb709e` | 18:57:46.942 |
| 18:53:54.101 | fetch `r3-9688f346` | **18:53:55.225**, while all builds above were open |
| 18:54:29.906 | build `r1-4f8a0358` | 18:57:46.430 |
| 18:55:34.190 | build `r2-28268d11` | 18:57:45.931 (first) |

- The builds complete last-in, first-out, the three inner ones within 1.1 s of each other, and the earliest one 14 s
  after them.
- The fetch marshals onto the same primary thread as the builds, yet answers in 1.1 s while a build has held that
  thread for almost three minutes. A queue would have held it until 18:57.
- Not observed: a push inside a build. Nothing but builds, one fetch and `health` arrived in that window. The push
  case below is our prediction from the same mechanism.

Our reading of the code (volt `457b6a700b`):
- `CodesysObjectModel.Build` (`Volt.Ide.Codesys/Ide/CodesysObjectModel.Build.cs:21-31`) runs the IDE's "build active
  application" command through `CommandManager.ExecuteCommand`, then reads the GLOBAL `MessageStorage` for its
  diagnostics (`:33-49`).
- `CodesysDispatcher.Run` (`Volt.Ide.Codesys/Ide/CodesysDispatcher.cs:55-69`) queues work with
  `InvokeInPrimaryThread(…, bAsync:false)`. We infer (from the timings, not from CODESYS source we cannot read) that
  the build command pumps the primary thread's message loop, so queued invokes run nested inside it.
- Nothing serializes ops above that: `BridgePipeHost.RunOp` (`Volt.Engine.Host/BridgePipeHost.cs:179-184`) and
  `DriverBase.RunOnStaThread` (`Volt.Engine/Ide/DriverBase.cs:118-129`) take no lock, and the tunnel serves requests
  concurrently on purpose (`RelayTunnel.cs:243-246`).

Outcome, if the reading holds:
- An outer build reads `MessageStorage` after a nested build overwrote it, so its diagnostics may describe another
  compile. (We cannot tell from the log whether the four results above differed.)
- A push nested in a build changes code mid-compile.
- A client that retries a build it believes timed out (PLCAssist's did, 60 s budget) stacks builds instead of
  queuing them, and each one makes the others slower.

TwinCAT marshals to a serial STA queue, so we expect no nesting there. Volt's wire-parity rule would still want both
vendors to answer a busy IDE the same way.

## Gate: only where it matches volt's design

This is what PLCAssist NEEDS, not a design handed to volt. Check it first against: `health` must keep answering while
a write holds the IDE (`relay-protocol.md:121-123`), "a write must not auto-retry", OpGuard's "the check is atomic
with the work", wire parity between vendors, and the CLI (a user running `volt build` in a terminal while the IDE
builds). Implement only what fits; record what does not and the volt-native alternative.

## What Changes

- **One engine gate for project-changing ops (build and push)**, taken before the work is marshalled, so a second
  one can never run nested inside the first on any vendor.
- **A build while a build runs** either joins the running build (and gets its result) or is answered with a coded
  `BUSY` ("a build is already running"); volt chooses. Joining makes a client's retry harmless.
- **A push while a build runs** is answered `BUSY` ("build in progress"), not run mid-compile and not queued without
  a deadline (see `relay-request-deadline`).
- Volt decides whether reads (`fetch`, `refs`) may still run nested in a build; PLCAssist only needs them not to
  change the project or the build's diagnostics.
- Optionally, a Warn line when an IDE-thread op starts while another is open, with both ids
  (`op (id) start depth=2 inside <id>`), so any other nesting shows up in the log.

## Impact

- `Volt.Engine.Host/BridgePipeHost.cs` (the gate), `Volt.Contracts` `BridgeErrorCodes` (`BUSY`), possibly
  `Volt.Engine/Sync/BuildService.cs` (join), regenerated wire docs, `relay-protocol.md` Concurrency section.
- Clients: PLCAssist maps `BUSY` to "the IDE is building — wait for that build, then try once", and stops treating a
  build retry as safe while one runs.

## Volt's assessment (2026-10-03)

**Verdict: VALID with corrections.** This is a real gap, and the only one of the five that affects data correctness.
The log shows pushes landing while a build was open. PLCAssist reported none.

- `relay-protocol.md:121-123` ("everything else takes the IDE and queues behind it"): CONFIRMED as written. It is not
  true on CODESYS today.
- The table: CONFIRMED, line by line, against `%LOCALAPPDATA%\Volt\logs\codesys-2026-10-03.log`. A second fetch,
  `r1-9cace7b6` (18:57:52.4 → 18:58:00.4), also answered before the outermost build finished.
- **WRONG:** "Not observed: a push inside a build. Nothing but builds, one fetch and `health` arrived in that window."
  Between 18:51:15 and 18:52:54, while build `r3-a76996ea` was open, the same log has **25 accepted pushes**
  (`VltE2E_par_*` creates and deletes, 2-3 s each). They came from Volt's own `vendor-parity` e2e tier. That tier talks
  to the pipe directly, so it leaves no `relay: <-` lines. The project had 881 items, the same count as PLCAssist's
  own push `r2-777a820a` at 18:51:04. Every CODESYS process writes to this one log file, and no line carries a pid,
  so "the same IDE" comes from the item count and is not proven. If it holds, pushes did run in the middle of a
  compile. (For Volt, separately: the parity tier wrote into an 881-item project, not its fixture. That is a test
  hygiene issue on Volt's side, outside this change.)
- Code: `CodesysObjectModel.Build` (`:21-31`) runs the command, then reads the GLOBAL `MessageStorage` (`:33-49`):
  CONFIRMED. `CodesysDispatcher.Run` uses `InvokeInPrimaryThread(…, bAsync:false)` (`:55-69`): CONFIRMED.
  `BridgePipeHost.RunOp` (`:179-184`) and `DriverBase.RunOnStaThread` (`:118-129` at `457b6a700b`, the same body
  today) take no lock: CONFIRMED. The tunnel serves requests concurrently (`RelayTunnel.cs:243-246`): CONFIRMED. The
  pipe server also serves every connection on a pool thread (`PipeServer.cs:172`), so the CLI path is just as
  concurrent.
- Mechanism (the build pumps the primary thread, so queued invokes run nested inside it): nobody has measured the
  CODESYS internals. But builds that finish last-in, first-out can only come from re-entrance on one thread; a queue
  cannot finish the last request first. Treated as CONFIRMED by the log. Task 1.1 measures it.
- The outer build's diagnostics: plausible but unmeasured. `GetBuildDiagnostics` reads the global store after
  `ExecuteCommand` returns, so a build reports whatever the latest compile left there.
- TwinCAT is serial: CONFIRMED. `StaDispatcher` is a `BlockingCollection` that one STA thread drains, so a second
  build queues there. The two vendors therefore handle a busy IDE differently today (one nests, one queues). That is
  a parity defect.

**Gap and fit: a real gap, not the client's misuse.** PLCAssist's retry of a build after 60 s multiplied the effect.
The smallest form FITS:
- **One gate in `BridgePipeHost`**, around `push` and `build`. It is the one entry point and is shared by both
  vendors. The gate is TRIED before the op is marshalled, never waited on. If another push or build holds it, the op
  is refused at once with a coded error.
- **Refuse, don't join.** Joining shares one result across requests and needs a result cache. Refusing is one flag,
  makes a retried build harmless (it is refused, not stacked), and removes the need for a deadline (see
  `relay-request-deadline`).
- What stays as it is:
  - `health` is untouched; it is never marshalled.
  - OpGuard stays inside the op, atomic with the work.
  - Nothing retries a write.
  - The CLI gets the same coded answer: a `volt push` or `volt build` while a relayed build runs is refused with a
    clear message.
- Reads (`refs`, `fetch`) are not gated, because they change nothing. On CODESYS a read may still answer during a
  build. That is a difference in timing, not in wire bytes.
- The code: **`IDE_BUSY`**, added to `BridgeErrorCodes` beside `IDE_UNSUPPORTED`. Message: "the IDE is running a
  build or push — nothing was applied".
- The optional "depth=2" Warn line is not built. The gate makes nested writes impossible, and a nested read is
  harmless.

**Plan: WILL BUILD.**
- The `BridgePipeHost` gate around `push` and `build`, with a non-waiting acquire. A held gate is answered with
  `IDE_BUSY`, identically on both vendors.
- The regenerated wire docs.
- The Concurrency section of `relay-protocol.md`, corrected: a push or build while another runs is refused, not
  queued.

Not built: joining a running build, and the depth Warn line. PLCAssist: map `IDE_BUSY` to "not applied — wait for the
running build, then try once". WHEN: in Volt's bridge lane after bridge-refusal-review and the three earlier
requests (directed-library-signatures, push-partially-applied-flag, st-roundtrip-fixed-point). It is **first** of
these five, and `relay-request-deadline` closes with it.
