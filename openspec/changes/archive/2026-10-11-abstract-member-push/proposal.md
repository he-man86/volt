> Superseded 2026-10-30: the current network-text spelling is packages/volt-cli/docs/network-text.html.

## Why

**An owner holding an abstract member pulled from CODESYS cannot be pushed back.** Found by the `vendor-facts` probe
(openspec `vendor-fact-probe` 3.1, 2026-10-11; DIALECT C2n). CODESYS holds an abstract method as an
`AbstractPOUMethodObject` with NO `Implementation` aspect. The pull reads its body as null; `StWriter` writes the
boundary line `IMPLEMENTATION ST` for it anyway (an empty body gets the line, `ImplementationMarker`); `StReader`
reads that back as `""`; the push sends `""` at a slot the object does not have, and `RequireSlot`
(`bridge-refusal-review` D26) refuses it: `UNSUPPORTED: CODESYS: 'TakePicture' has no Implementation — a body was
pushed at a slot this object does not have`. Before D26 the same `""` was dropped silently, which is why the
2026-10-02 measurement passed.

Reach: 12 `ABSTRACT` member texts in the six corpora, all pro2193 — 11 METHOD and 1 PROPERTY (`Busy`, whose GET is
written with `IMPLEMENTATION ST`) in 7 owner files. Every edit of those 7 files, of ANY part, is refused. Not niche.

The driver cannot tell the two cases apart today: an empty ST body and a missing `Implementation` aspect both read
null (`CodesysDriver.ReadBody`: `BodyText` maps a whitespace-only body to null). D26 names where the fix goes: "the
producer is fixed, not a driver table".

## What Changes

- The pull distinguishes "this member has no body slot" from "this member's body is empty", and the text says which,
  so the push sends no body (null) for a member that has no slot. The text form is this change's design decision
  (candidates: no boundary line under a member without a slot; or the declaration's `ABSTRACT` decides) — it must
  hold for TwinCAT too, where an abstract method's slot is unmeasured.
- Measured (2026-10-11, `vendor-facts` `merged-classes`): the abstract PROPERTY `Busy`'s GET is an
  `InterfacePropertyAccessorObject` with no `Implementation` either (`class.busyget`, `implementation.busyget`), while
  the pull writes it with `IMPLEMENTATION ST` — the same bug. TwinCAT's abstract members are unmeasured.
- Red test, committed skipped: `test/Volt.Ide.Codesys.Tests/CodesysAbstractMemberPushTests.cs` — un-skipped by the fix.

## Impact

- `Volt.Ide.Codesys` (`CodesysDriver.ReadBody`), possibly `Format/St` (`StWriter` / `StReader`) and the LSP parser
  if the text form changes; a file-format change re-pulls 7 pro2193 files.
