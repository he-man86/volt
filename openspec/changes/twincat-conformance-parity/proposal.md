# TwinCAT conformance parity — ask TwinCAT the questions CODESYS has already answered

## Why

**The TwinCAT "divergence" is mostly unasked questions, and every attempt to measure it has been corrupted.**

| | recorded | fixtures covered | of 2530 |
|---|---|---|---|
| CODESYS | 2026-09-17 | 893 | 35% |
| TwinCAT | **2026-07-07** | **280** | **11%** |

The replay ratchet reads **266 TwinCAT against 866 CODESYS** and is read as the LSP agreeing with one vendor far
better than the other. It is not. TwinCAT's ground truth predates essentially every fixture written since — the
census sweeps took the suite from ~967 to 2530 *after* that recording — so most of the gap is questions TwinCAT
has never been asked.

**Measured, on the 406 fixtures both vendors have answered: 96.1% identical build verdicts**, 342 of those with
byte-identical message sets. TwinCAT is not a different compiler with a different opinion; it is an unmeasured
one.

## The four defects that stopped it being measured, each found by running it

None of these announced itself. Every one produced **plausible wrong data or a misleading failure**, which is why
a 2.5-month-old recording survived this long.

1. **Two bridges served one pipe name.** A second `NamedPipeServerStream` on a live name is not a collision — it
   is another INSTANCE of the same pipe, and Windows hands each client connection to whichever is waiting. The
   dev script launched a fresh worker; the connector tray launched its own from a build 11 days older; both
   served `volt.bridge.twincat.<pid>`. `connect` answered `{ok:true}` from one and the next `refs` answered
   `PLC_DISCONNECTED` from the other. Two code comments asserted a name collision would fault at the bind. It
   never did, which is exactly why nothing guarded it.

2. **The launcher reported someone else's worker as its own.** `ide.ps1` decided "attached" by grepping a shared,
   day-long log for a line every worker writes — including the connector's, and every earlier run that day. So it
   printed "worker attached" for a bridge it had not started and could not vouch for.

3. **The recorder wrote its result once, at the end.** A full TwinCAT run is over two hours and TwinCAT's
   out-of-process COM does not survive two hours. The first run died at fixture ~130 — a push hung for 13 minutes
   and came back to an invalidated project tree — and all 130 recordings went with it.

4. **The recorder observed its pristine PLC_PRG instead of deriving it.** `plcOriginal`, the text every fixture is
   restored to, was read off the LIVE PLC_PRG at startup — valid only if the previous run *finished*. A killed run
   dies between "instantiate this fixture" and "restore", leaving PLC_PRG declaring that fixture; the next run
   adopts it as pristine and writes it back after every fixture. Six fixtures recorded
   `Unknown type: 'FB_LANG_bound_lint_at_min'` as though it were their own answer — **six bad rows in 1190, rare
   enough to read as a real TwinCAT divergence rather than as damage.**

Defect 4 is the one worth remembering: it is the shape this whole suite exists to prevent — a confident, specific,
wrong answer that looks like evidence.

## What Changes

- **Re-record `twincat.build.json`** over all fixtures, against a bridge built from source, with exactly one
  worker serving the pipe and the connector tray stopped.
- **Adopt it and move the ratchet**: raise the TwinCAT replay floor from 266 to what the fresh recording supports,
  and re-check every entry in `KNOWN_DIVERGENCES.twincat` against real data rather than a July recording — each
  one is currently justified by a measurement that predates 2250 fixtures.
- **Keep the four fixes** that made a live two-hour run survivable at all (all landed): the pipe-name guard in
  `PipeServer`, the launcher's own-worker check, recorder checkpointing with `--resume`, and the derived pristine
  PLC_PRG plus an orphan sweep.
- **Decide the recorder's transport.** It hand-rolls a bridge client — its own `version()`, `ifVersion` handling,
  delete/restore — and that reimplementation was the common factor in two of today's failures. The `volt` CLI
  already does versioning, conflict recovery and reconnect, and `CLAUDE.md` makes the same argument for the e2e
  tier: drive it the way a user does, because a bespoke harness proves a path that ships with nothing. Decide on a
  measured batch, not on taste.

## What this is not

**Not a bridge-parity change.** The wire is byte-identical by design and `Volt.Engine` is shared; the archived
`twincat-bridge-parity`, `twincat-graphical-create-parity` and `twincat-migration-parity` changes cover the
driver. This is about the LSP's conformance oracle having only one vendor's answers.

**Not a licence to mask.** A real divergence found by the fresh recording goes in `KNOWN_DIVERGENCES` with the
measurement that justifies it, or it is a bug. The point of re-recording is to find out which.
