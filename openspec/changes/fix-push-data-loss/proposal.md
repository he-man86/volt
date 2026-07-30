## Why

Two ways `volt push` could destroy an engineer's work, both found by the line-by-line audit
(`openspec/changes/audit-volt-cli-src`). CFC/SFC bodies are documented **read-only** precisely because Volt cannot
round-trip them, and a push is supposed to refuse rather than damage one.

**1. A read-only graphical POU *child* was flattened (FIXED here).** The root POU is protected by asking the IDE
for its live `BodyLanguage`. The child path decided from the incoming TEXT instead:
`VgBody.Is(cimpl) && !VgBody.IsEditable(...)`. But a CFC/SFC body has **no text form** — it materializes as
`Materializer.GraphicalBodyMarker`, i.e. `(* @volt-graphical: CFC *)` — and `VgBody.Is` matches only a
`NETWORK <n> <LANG>` header, so it **rejected the marker**. The guard therefore never fired for the one case it
existed to stop: the marker fell through to the textual path and `ide.WriteText` replaced a CFC method body with a
comment, silently, on a push that reported success.

`VgBody`'s own contract already stated the rule: CFC/SFC "are not editable, but that is enforced by **live IDE
state on push, not by any content marker**." The root guard obeyed it; the child guard could not.

**2. A pushed item did not survive the TwinCAT IDE being killed (STILL OPEN).**
`IIdeSession.FlushPendingWrites` documents "TwinCAT SaveAll … called after applying a push", and
`test/e2e/lifecycle/ide-restart.test.ts` asserts a pushed item survives the IDE dying. It does not: the item is
absent after a reopen. If a push can report success while the work exists only in the IDE's memory, an IDE crash
loses committed work. Root cause not yet established — see `tasks.md` §3.

## What Changes

- The child body-format guard now decides from the IDE's **live** `BodyLanguage`, mirroring the root guard's three
  cases (read-only CFC/SFC; graphical-in-IDE vs textual push; textual-in-IDE vs graphical push), and additionally
  refuses the round-tripped marker outright — that text is never something to write.
- The check runs as a **pre-pass over all children before anything is written**, so a refusal leaves the IDE
  untouched. Previously the root body was already written by the time a child was refused: not data loss, but the
  IDE would hold the new root beside the old child.
- `Materializer.IsGraphicalBodyMarker` derives from the same literal the writer uses, so reader and writer cannot
  drift.
- Still to do: diagnose and fix the durability gap (2), then take `ide-restart` to 2 pass / 0 fail.

Behaviour change, deliberately: pushes that previously silently destroyed a graphical child body now refuse with a
per-item conflict carrying `UNSUPPORTED`. That is the same shape the root guard already used.

## Capabilities

### New Capabilities

- `push-preserves-graphical-bodies`: a push never overwrites a body whose format it cannot round-trip, decided from
  live IDE state, and a refusal is atomic.
- `push-durability`: a push that reports success has committed the work to the IDE's own store.

## Impact

- `Volt.Engine/Sync/PushService.cs`, `Volt.Engine/Workspace/Materializer.cs`; shared Core, so it applies to both
  vendors identically.
- Verified: 324 (317 + 7 new) / 116 / 76 unit, live CODESYS e2e 92 pass / 0 fail. The 7 new tests were **red before
  the fix**, and the failure mode they captured was "no exception thrown" — i.e. the push silently succeeded.
- The durability gap (2) needs live TwinCAT and is not yet fixed; `ide-restart` stays red for it and must not be
  weakened.
