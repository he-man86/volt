## Why

**The same abstract member reads differently by vendor — the Volt layer must be identical.** `abstract-member-push`
(archived 2026-10-11) fixed CODESYS's slotless abstract members by stating them `IMPLEMENTATION NONE`, keyed on the
VENDOR'S STORAGE (a declared-and-null `Implementation`). Measured there (DIALECT C2n): TwinCAT's abstract members always
have a body slot (`ImplementationText` = `""`), so TwinCAT pulls the same declaration as `IMPLEMENTATION ST` with an empty
body; and a CODESYS abstract method whose class is a `POUMethodObject` has a slot too — made by scripting
(`create_method`) or by the IDE (pro2193's `ModuleWithStateFB.Cyclic`) — so even on CODESYS the text depends on the
object's class, not on its declaration. A cross-vendor or blank-project migration of pro2193 refuses its 7 owner
files. The owner (2026-10-11): "they need to be identical on the volt layer" — the wire-parity rule (a divergence only
after two measured alternatives AND owner OK; the OK was never given and is now refused).

## What Changes

**One rule, decided by the declaration, not the storage:** an `ABSTRACT` member (METHOD, or a PROPERTY's accessor under
`PROPERTY ABSTRACT`) with no code is `IMPLEMENTATION NONE` on both vendors, whoever made the object.
- Pull: CODESYS slotless → NONE (as today); CODESYS `POUMethodObject` with ABSTRACT text and an empty body → NONE;
  TwinCAT abstract member with an empty slot → NONE.
- Push of NONE: no write where the object has no slot (CODESYS `AbstractPOUMethodObject`), an empty body where it has one
  (CODESYS `POUMethodObject`, TwinCAT). A create, rename or retype of an ABSTRACT member with NONE is accepted on both
  vendors (today refused) — the migration refusal goes away.
- An ABSTRACT member WITH code: measured first on both compilers. If both refuse it (expected), Volt refuses a body
  under an ABSTRACT declaration by name before any write; if a vendor accepts it, that is written down and the member
  keeps `IMPLEMENTATION ST` with its code on that vendor only (the one case the text cannot unify, for owner review).
- A non-abstract member with an empty body stays `IMPLEMENTATION ST` on both (unchanged).

## Impact

`Volt.Engine` (`BodyFormatGuard`, `ImplementationMarker`), `Volt.Ide.Codesys` (`CodesysDriver.ReadBody`),
`Volt.Ide.Twincat` (its body read/write), the vendor-facts table (new rows), DIALECT C2n, e2e on both vendors plus the
vendor-parity suite. TwinCAT's pulled text for abstract members changes ST → NONE (re-pull); CODESYS's only for
slotted abstract members (`POUMethodObject` / `PropertyAccessorObject`) — in the corpora exactly one, pro2193's
`Cyclic`. The LSP already reads NONE.
