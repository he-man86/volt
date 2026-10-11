## 1. Measure

- [x] 1.1 The abstract PROPERTY accessor's slot on CODESYS (`vendor-facts` `merged-classes`, `implementation.busyget`)
      and an abstract method's and accessor's slot on TwinCAT (a `vendor-facts` row, never a probe script).
  - CODESYS half measured 2026-10-11 (`vendor-fact-probe` gate 3): the abstract method and the abstract property's
    GET (`InterfacePropertyAccessorObject`) both have NO `Implementation`.
  - **TwinCAT measured 2026-10-11: an abstract member HAS a body slot — the bug is CODESYS-only, no TwinCAT twin
    test (3.1).** New row `abstract-member-slot` (C2n, TwinCAT; `[PROBE: abstract-member-slot]` on DIALECT C2n, which
    now carries the finding), snapshot in `scripts/vendor-facts.twincat.json`, two agreeing runs on Project14
    (`VOLT_E2E_INSTANCE=abstract-member-push bun scripts/vendor-facts.ts twincat --only abstract-member-slot [--write]`;
    11.5 s / 13.8 s; the second "every fact as committed"). The runner now takes its instance from
    `VOLT_VENDOR_FACTS_INSTANCE` (default `vendor-fact-probe`; review fix in the gate, below), so a change runs it on its
    own `ide.ps1` instance. Values, on a `FUNCTION_BLOCK ABSTRACT`:
    - classes: FB `ItemType 604`, method `609` (script-made and push-made alike), property `611`, GET `613`.
    - `item.ImplementationText`: `""` on the script-made `METHOD ABSTRACT Pick` (CreateChild 609 + declaration) after
      the create and after save/close/reopen (`implementation@script-made`, `@saved`; not read after the edits); `""`
      on the push-made one (pushed in the shape Volt's text writer produces: `IMPLEMENTATION ST`, empty body) and on the
      push-made `PROPERTY ABSTRACT Busy`'s GET after the push, after save/close/reopen and after the edits
      (`implementation.pmethod|pget@push-made|saved|property-edited`); `null` on the property itself (as on any
      property).
    - saved `.TcPOU`: `<Implementation>` with an empty `<ST>` under both methods and under the GET (`file.*`).
    - the CODESYS-refused round trip is ACCEPTED on TwinCAT: the owner's pulled text with a line added under
      `METHOD ABSTRACT Pick : INT`, then under `PROPERTY ABSTRACT Busy : BOOL`, pushed back — both accepted, both lines
      landed (`declaration.*@property-edited`).
    - a body written at the abstract method through the vendor API (`ImplementationText = "Pick := 1;"`) is accepted
      and reads back right after the write (`body`) — TwinCAT does not refuse a body on an abstract method at write
      time. Whether it survives a save/reload is NOT measured (no read after the write).
    - found on the way: a property CreateChild (611) makes NO Get/Set child (the first run's `find 'Get'` answered 0
      items); the push creates the GET itself (613), so the row makes its property only through the push.
    - not measured, refused by name in the row (`ide-authored`): an abstract member made by the XAE's own Add Method
      dialog — 0 ABSTRACT texts in Project13, Project14 and `twincat-project14`, and the CODESYS corpora hold no
      `.TcPOU`.
  - NOT recorded: the fetched wire text of a TwinCAT abstract member (no key holds `VltA_PushBase.pou`'s pulled
    text). That today's TwinCAT pull writes `IMPLEMENTATION ST` + empty body under one is inferred — the slot reads
    `""` (not null) and `StWriter` writes the line under every non-null body — not measured; the edits above were
    pushed in that writer shape, so "the pulled text" there means the shape Volt writes, not a recorded pull.
  - Consequence for 2.1: a TwinCAT abstract member has the slot (measured) and accepts `IMPLEMENTATION ST` + empty
    body on push (measured), so the text form must be able to carry that for it; "no body slot" is a CODESYS-object
    fact, not one the `ABSTRACT` keyword decides — so the declaration's `ABSTRACT` alone cannot pick the form on both
    vendors. 2.1 records the fetched TwinCAT text (a `vendor-facts` read) before relying on what today's pull writes.
  - **Gate 1 (2026-10-11): two review findings, both fixed.**
    - `vendor-facts.ts` read `VOLT_E2E_INSTANCE` for the instance it `up`s and `down`s, so a vendor-facts run would
      restart and then close a live e2e IDE that variable names. Now its own `VOLT_VENDOR_FACTS_INSTANCE` (unset =
      `vendor-fact-probe`; set but empty refused by name) via `instanceOf(env)`; red first in
      `test/unit/vendor-facts.test.ts` ("runs on its own instance"), then green. README + header updated.
    - The 1.1 TwinCAT bullets and DIALECT C2n said more than the snapshot measured: narrowed to the keys that exist
      (script-made method not read after the edits; `body` read only right after the write; the fetched TwinCAT wire
      text not recorded, so "today's pull writes `IMPLEMENTATION ST`" is marked inferred and 2.1 records it first).
    - Numbers: volt-cli `tsc` clean; `bun test test/unit` 75 pass / 0 fail (was 74 + the new test); `dotnet test
      Volt.sln` all green — Repo.Gates 160, Contracts 34, Twincat 450, Relay 62, Connector 115, Engine 2307 (+1 skip),
      Codesys 309 (+1 skip: `CodesysAbstractMemberPushTests`, red until 3.1), Cli 264; `openspec validate` valid. No
      LSP, fixture or transpiler change (fixture map not regenerated).

## 2. Design

- [ ] 2.1 Decide the text form that tells "no body slot" from "empty body" on both vendors (proposal, What Changes),
      and whether the LSP parser changes with it.

## 3. Fix

- [ ] 3.1 Un-skip `CodesysAbstractMemberPushTests` (red: the refusal above); the TwinCAT twin if 1.1 finds the same.
- [ ] 3.2 The fix at the producer; DIALECT C2n updated; a live e2e round trip of an abstract member on CODESYS.
