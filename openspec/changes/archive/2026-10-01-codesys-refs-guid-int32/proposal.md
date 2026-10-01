## Why

**`refs` failed on a customer-shaped CODESYS project.** On a copy of the Pro2193 fixture the bridge's `refs` failed in
2 of 3 sessions with:

```
INTERNAL_ERROR Object of type 'System.Guid' cannot be converted to type 'System.Int32'
```

so that project could not be pulled at all. Found 2026-09-27 during `dut-subtype-on-the-wire` task 1.1/1.3 (moved
here from its task 1.5; evidence in `packages/volt-cli/scripts/dut-subtype-push.log:53`).

What is known:
- Both failing sessions had first run `probe-dut-subtype-push.py`'s scripting read over three DUTs whose wrapper
  reported handle 0 — `SER_OperationModeType`, `enumRecipeCommandResult`, `PlcDataType`. The probe's own
  `GetObjectToRead` failed on them with the same text (those lines were not kept verbatim).
- The session that called `refs` BEFORE any probe read worked.

What is not: whether the probe is the cause (it poisoned the session), or whether the bridge's own
`CodesysObjectModel` `GetObjectToRead(HandleOf, GuidOf)` hits the same objects and only fails some of the time. A
`refs` failure on a customer-shaped project is a bridge bug until shown otherwise.

## What Changes

- **Reproduce first, both ways**, and record the result: (a) Pro2193 copy → probe read of `SER_OperationModeType` →
  `refs`; (b) Pro2193 copy → `refs` with no probe read, repeated enough times to call it stable or not.
- **If the bridge path fails on its own:** find the call that passes a Guid where an Int32 handle is expected
  (the `HandleOf` / `GuidOf` pair in `CodesysObjectModel`), fix it at that line, and pin it with a test built on
  the IDE's ground truth (a C# fixture of the object shapes that fail).
- **If only the probe causes it:** fix or retire the probe, and record in DIALECT why a failed scripting read
  poisons the session — then `refs` must still either succeed or refuse THAT item by name (unreadable), never fail
  the whole walk.
- **Either way, one item never fails the walk.** An object the bridge cannot read is reported unreadable by name;
  `refs` as a whole does not throw `INTERNAL_ERROR` for it.

## Impact

- `packages/volt-cli/src/Volt.Ide.Codesys` (the object model read path), possibly `Volt.Engine/Sync/FetchService`.
- `packages/volt-cli/scripts/probe-dut-subtype-push.py` (if it is the cause).
- Tests in `test/Volt.Ide.Codesys.Tests`; DIALECT.md for the vendor fact.
- Check TwinCAT for the same pattern (bridge-bug parity), even if it cannot fail the same way.
