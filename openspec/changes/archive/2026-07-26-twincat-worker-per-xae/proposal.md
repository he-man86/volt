## Why

Volt models its two IDEs **asymmetrically**, and the TwinCAT side pays for it:

- **CODESYS** — one in-proc host per running IDE, each on `volt.bridge.codesys.<pid>`, discovered by listing the
  pipe namespace. Ops on different IDEs run in different processes → **parallel**. The host is loaded into the IDE
  and **dies with it — zero supervision.**
- **TwinCAT** — ONE external worker on `volt.bridge.twincat` that **multiplexes every running XAE** over the COM ROT.
  All ops across all projects **serialize** on its single STA thread, and the worker carries real machinery to keep
  the windows straight: it enumerates the ROT on every health snapshot; it `BindByProject` **by name** because the
  ROT moniker is *ephemeral* (TcXaeShell re-registers its DTE with a fresh cookie mid-session); and it has a
  same-name ambiguity when two XAE share a project name.

That machinery is a live source of flakiness — observed this week: `0x800706BA` (RPC server unavailable), and
`reattach: no running TwinCAT/VS instance to bind` **while the XAE process is alive**. The single worker's op
serialization is the one place Volt's parallel-IDE flow is *not* symmetric with CODESYS.

The key realization: TwinCAT automation is **out-of-process COM**, so it does **not have to be** one multiplexing
worker. It can be **one worker per XAE** — attaching to a single window by its stable **process id**, each on its own
pipe — exactly like CODESYS. That unifies the model, deletes the multiplexing/moniker/same-name machinery, likely
removes a chunk of the COM flakiness (attach by pid, not by ephemeral name), and makes ops parallel.

## What Changes

- **One `VoltBridgeTwincat` worker per running XAE**, each attaching to ONE window by process id (stable, unlike the
  moniker), each serving `volt.bridge.twincat.<pid>`. The worker never multiplexes — it owns one XAE.
- **The connector gains a TwinCAT supervisor.** It runs a LIGHT ROT enumeration (XAE pid + project names only — no
  PLC-tree walk), spawns a per-pid worker for each running XAE, and reaps a worker when its XAE exits or crashes.
  (CODESYS needs no supervisor — its in-proc host self-manages; this supervisor is the *irreducible* TwinCAT cost of
  going external-per-XAE, and the change must own it honestly.)
- **`IProjectSource` unifies to per-pipe for BOTH vendors.** `CodesysProjectSource`'s fan-out and the single
  `PipeProjectSource` collapse into ONE per-pipe source. The worker-side multiplexing goes: `RotInstances.Enumerate`
  over all windows, `BindByProject` (attach becomes pid-targeted), and the same-name-within-a-worker disambiguation.
- **Ops parallelize**: two TwinCAT projects sync in two worker processes, matching CODESYS.

## Non-Goals

- **No CODESYS change** — it is already per-process; this brings TwinCAT to *its* model, not the reverse.
- **No wire/contract change** — `health`/`connect` are byte-identical; the connector still concatenates each pipe's
  self-describing rows into the one unified list. The same-name-across-instances collapse stays the connector's
  accepted identity limit (vendor+name), unchanged.
- **Parallel ops is a benefit, not the driver.** The driver is *unifying the model* and *killing the moniker /
  multiplexing flakiness*; the parallelism falls out for free.
- Not a rewrite of the shared engine, the CLI, or the frontends — this is connector + TwinCAT-worker only.
