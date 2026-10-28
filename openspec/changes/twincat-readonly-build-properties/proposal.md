# Proposal (from PLC Assist, 2026-10-27)

## Why

A field chat on TwinCAT 3.1.4024.75 (bridge 0.1.18029) read and wrote POUs normally for an hour (reads, a create,
builds clean). Then, from one turn on, EVERY item of the PLC project refused the same way, on read and on write:

> `'<name>': TwinCAT marks its CompilerDefines property read-only — Volt has measured it only as the object's own value
> (DIALECT C40), so it is not pulled.`

That is the `Own(...)` refusal in `TcObjectModel.Properties.cs` (`readonly="true"` on `CompilerDefines`). Nothing in the
chat changed the properties; between the last good read and the first refusal the user was running the PLC and watching
it from an HMI. Our guess (NOT measured): **while the IDE is logged in to the PLC (online), TwinCAT publishes the build
properties `readonly`**. The user had no way out: the message names a property they never touched and does not say what
to do, so the model could only say "the IDE blocks reading".

C40 says these properties are never `readonly` (under an excluded folder or POU too). This is a state C40 did not
measure.

## What Changes (proposed, Volt decides)

1. Reproduce: a TwinCAT PLC project, log in (with and without download, run and stop), read an item's `ProduceXml`,
   and record which VSProperties turn `readonly` (only `CompilerDefines`, or `LinkAlways`/`External`/`Exclude` too).
   Also: does a push work at all while logged in?
2. If online is the cause:
   - **Read:** a readonly build property while logged in is still the object's own value (its `<Value>` is there): read
     it, and let only the write path care about readonly. A pull should not need the project offline.
   - **Write:** refuse by name with the remedy, e.g. `TwinCAT is logged in to the PLC: log out (Online > Logout) to
     change '<name>'`, under a code the app can act on (or `IDE_BUSY`-like), not `UNREADABLE`.
3. If it is something else: the refusal names that state and its remedy instead of "Volt has measured it only as the
   object's own value".
4. DIALECT row (C40 amended) and a regression test per state found.

## Not in scope

CODESYS (no field case); the AdditionalAllocation refusal (unchanged).
