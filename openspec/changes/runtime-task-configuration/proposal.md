## Why

Sim-Assist (owner, 2026-11-05) needs a CODESYS-style task configuration: tasks that call PROGRAMs, with a watchdog, and live cycle time and jitter. Sim-Assist stores a PLC as plain files, and the owner wants tasks stored "the same as volt does for codesys": the `.task` descriptor under `Task Configuration/` (C# `TaskDescriptorFormat`).

Today the TypeScript side (`volt-lsp-iec`) reads `.task` only for reachability roots (`workspace-refs.ts`, `Calls:` only), and the transpiled runtime has one entry, the main program. Sim-Assist must not parse `.task` itself or invent a second format. Volt owns the file format and the language, so the file format and the per-task entry belong here. Sim-Assist owns the scheduler (wall clock, intervals, watchdog trip, statistics) and the UI.

## What changes

- **`.task` in TypeScript**: `readTask(text)` / `writeTask(settings)` in `volt-lsp-iec`. They are byte-compatible with C# `TaskDescriptorFormat` (same labels, `Pad` 11, watchdog spelling `[off ]<time> <unit> (sensitivity <n>)`, member labels, the same refusals by line). They are exported in the platform-neutral bundle surface Sim-Assist builds from.
- **Diagnostics on `.task`**: an unknown or duplicate field, a `Calls:` name that is not a PROGRAM, an interval that is not a TIME, and a PROGRAM called by two tasks (a warning, as CODESYS gives).
- **Per-task entry in the transpiled runtime**: the compiled application exposes one callable per task (`runTask(name)`), which runs that task's `Calls:` in order on the shared globals. It replaces the single implicit main-program entry. A project with no `.task` keeps an implicit task calling the main program, so the host behaves as today.
- **Task facts for the host**: the parsed settings of each task (type, interval in ns, priority, watchdog enabled/time/sensitivity, calls) are available from the build result, so the host never reads the descriptor text.

## Non-goals

- No scheduler, clock or watchdog enforcement in volt. The host calls `runTask` on its own timeline, measures cycle time and jitter, and decides a watchdog trip (a synchronous scan cannot be pre-empted in JS; the host trips after a scan exceeds `time` on `sensitivity` consecutive cycles, as CODESYS counts).
- Event, freewheeling and external-event task types are parsed and written, but only Cyclic runs, until the host asks for more.
- No change to the C# format or the bridge.

## Question for volt (from Sim-Assist, owner leaning the same way)

Sim-Assist proposes that the scheduler stays in the host, and volt's contract stays at the format, the diagnostics, `runTask(name)` and the task facts. The scheduler's clock is the host's: Sim-Assist runs the PLC in a worker locked to the sim's 20 ms tick, with pause, step and Reset. A future volt runtime (Rust, or on a real target) would have its own clock and scheduler anyway, so a TS scheduler in volt would serve one host only. Watchdog semantics are CODESYS's (a trip after `sensitivity` consecutive cycles over `time`), so both hosts agree on meaning without sharing code. Does volt agree, or does it see a reason the scheduling order (priority, overlap, IO update per task) must be in volt so both hosts behave the same?
