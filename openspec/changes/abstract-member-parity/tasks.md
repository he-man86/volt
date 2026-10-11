## 1. Measure (vendor-facts rows, never a probe script)

- [x] 1.1 Both compilers on an ABSTRACT METHOD / abstract PROPERTY accessor that HOLDS code (CODESYS SP21 via a
      `POUMethodObject` with ABSTRACT text; TwinCAT via its slot): does the build refuse it? Record the message.
  - **Both compilers refuse it at BUILD, with the same words; neither refuses the WRITE.** New `vendor-facts` row
    `abstract-member-code` (C2n, both vendors; `[PROBE: abstract-member-code]` on DIALECT C2n), snapshots in
    `scripts/vendor-facts.{codesys,twincat}.json`. Runs (`VOLT_VENDOR_FACTS_INSTANCE=abstract-member-parity bun
    scripts/vendor-facts.ts <vendor> --only abstract-member-code [--write]`): CODESYS 22.7 / 23.7 s `--write`, 24.3 s
    "every fact as committed"; TwinCAT 19.8 / 19.7 / 19.6 s `--write`, 19.6 s "every fact as committed". Shape: an
    `ABSTRACT` FB with `METHOD ABSTRACT Pick : INT` and `PROPERTY ABSTRACT Busy : INT`, a non-abstract
    `VltA_CodeImpl EXTENDS` it overriding both, used from the task's `PLC_PRG`; code written at each slot through the
    vendor API (`Pick := 1;`, then `Busy := 1;` in the GET), a build after each.
    - CODESYS: `C0433 Error` "The ABSTRACT method VltA_CodeBase.Pick must not contain any statements"; for the GET
      `C0433 Error` "The ABSTRACT method VltA_CodeBase.__getBusy must not contain any statements".
    - TwinCAT: `success: false`, error (no code) on `VltA_CodeBase.pou` member `Pick` / `Busy`, the SAME two texts.
    - The SET (gate-1 review): code in the abstract property's SET (`Busy := 1;`), built — CODESYS `C0433 Error`
      "The ABSTRACT method VltA_CodeBase.__setBusy must not contain any statements"; TwinCAT `success: false`, error
      on member `Busy`, the same text. The TwinCAT property is now push-made with a GET AND a SET (the derived FB's
      too), so its SET is the push's own (`class.set` `ItemType 614`); the CODESYS SET is `create_property`'s
      (`PropertyAccessorObject`, `STImplementationObject`). The write is accepted and reads back on both
      (`body.set@set-code`), an empty body written after it persists across save/reopen (`body.set@saved` = `""`,
      TwinCAT `file.set-st` = `""`), and the earlier facts are unchanged on CODESYS; on TwinCAT only the `fetched*`
      texts changed, by the added `SET` / `IMPLEMENTATION ST` / `END_SET` lines.
    - Controls: the same members with EMPTY bodies build clean on both (CODESYS `[]`; TwinCAT `success: true`, only
      "generate boot information..."); an unknown name in the derived method's body is reported on both (CODESYS
      `C0032` + `C0046` ×2, TwinCAT the same two texts) — the build compiles these POUs.
    - The write is accepted on both and the code reads back (`body.*@method-code|get-code`), and the fetched text
      carries it under `IMPLEMENTATION ST` (`fetched@method-code|get-code`).
    - FOUND on the way: TwinCAT's build compiles only what a task reaches. The first TwinCAT run used a program of its
      own that no task called — it reported NOTHING, not the abstract-member code and not the unknown-name control.
      The row now calls the derived FB from `PLC_PRG` (restored at cleanup); CODESYS answered with the caller in
      `PLC_PRG` from the first run.
  - Consequence for 2.1: the expected case — both refuse, for the method, the GET and the SET. A body under an `ABSTRACT` declaration can be refused by
    name before any write on both vendors; no vendor-only `IMPLEMENTATION ST` with code remains to unify.
- [x] 1.2 TwinCAT: the fetched wire text of an abstract member today (the inferred `IMPLEMENTATION ST`, now recorded),
      and persistence of an empty body written at its slot across save/reopen.
  - **Recorded (no longer inferred): today's TwinCAT pull writes `IMPLEMENTATION ST` with an empty body.** New read
    op `fetched` in the vendor-facts runner (the item text as the SHIPPED bridge's `fetch` answers it — what `volt pull`
    writes; read over the pipe by the runner, never a core; test-first in `test/unit/vendor-facts.test.ts`, 3 tests red
    then green). `abstract-member-code` `fetched*`:
    - script-made (`CreateChild 609` + ABSTRACT declaration), after create and after save/reopen:
      `METHOD ABSTRACT Pick : INT\nIMPLEMENTATION ST\nEND_METHOD\n`.
    - push-made (Volt's writer shape): `METHOD ABSTRACT Pick : INT\nIMPLEMENTATION ST\nEND_METHOD\n` and
      `PROPERTY ABSTRACT Busy : INT\nGET\nIMPLEMENTATION ST\nEND_GET\nEND_PROPERTY\n`.
  - **An empty body written at the slot persists.** After code at each slot, `ImplementationText = ""` through COM:
    reads `""` right after (`body.*@emptied`) and after save/close/reopen (`body.*@saved`); the saved `.TcPOU` holds an
    empty `<ST>` under the method and under the GET (`file.method-st`, `file.get-st` = `""`); the fetched owner text
    after the reload is byte-identical to the one before any code (`fetched@saved` = `fetched@property-made`). Classes
    as in `abstract-member-push` (FB 604, method 609, property 611, GET 613).
- [x] 1.3 CODESYS: a script-made ABSTRACT method (`create_method` + ABSTRACT text) — its class and slot, and what the
      pull writes today.
  - **A `POUMethodObject` with an `STImplementationObject` (a slot), and the pull writes `IMPLEMENTATION ST`** —
    the same text TwinCAT pulls for the same method. **The CLASS and its slot decide the text, not who made the
    object** (gate-1 review): pro2193's `ModuleWithStateFB.Cyclic` is user-made (the IDE, not scripting), and it is a
    `POUMethodObject` with an `STImplementationObject` too (`merged-classes` `class.cyclic`,
    `implementation.cyclic`, measured live on a Pro2193 copy in `abstract-member-push` 3.2 and unchanged since); it
    pulls `METHOD PROTECTED ABSTRACT Cyclic` / `IMPLEMENTATION ST` / `END_METHOD` today — 1 of pro2193's 12 abstract
    member texts, the other 11 slotless (`IMPLEMENTATION NONE`). So the rule 2.1 states keys on the declaration, and
    3.3's re-pull of pro2193 expects exactly ONE CODESYS line to change, `Cyclic`'s `IMPLEMENTATION ST` → `NONE`.
    `abstract-member-code`, on a `CodesysTestProject` copy:
    - `create_method` + `METHOD ABSTRACT Pick : INT`: class `_3S.CoDeSys.MethodObject.POUMethodObject`,
      `object.Implementation` `_3S.CoDeSys.STObject.STImplementationObject`, both unchanged after save/close/reopen.
    - `create_property` + `PROPERTY ABSTRACT Busy : INT`: `PropertyObject` (no `Implementation`), its GET (and SET) a
      `_3S.CoDeSys.PropertyObject.PropertyAccessorObject` with an `STImplementationObject` — NOT pro2193's slotless
      `InterfacePropertyAccessorObject`; unchanged after save/reopen.
    - Fetched today: `METHOD ABSTRACT Pick : INT\nIMPLEMENTATION ST\nEND_METHOD\n` (byte-identical to TwinCAT's
      script-made and push-made method) and `PROPERTY ABSTRACT Busy : INT\nGET\nVAR\nEND_VAR\nIMPLEMENTATION ST\n
      END_GET\nSET\nVAR\nEND_VAR\nIMPLEMENTATION ST\nEND_SET\nEND_PROPERTY\n` (the create's default accessors; the
      TwinCAT property here was push-made with a GET only, so the property texts are not a parity pair).
    - An empty body written back after code (`textual_implementation.replace("")`) persists across save/reopen
      (`body.*@saved` = `""`), and the fetched text after the reload equals the one before any code.
  - So today one `ABSTRACT` declaration pulls THREE ways: CODESYS slotless (`AbstractPOUMethodObject`,
    `InterfacePropertyAccessorObject`) → `IMPLEMENTATION NONE`; CODESYS slotted (`POUMethodObject`,
    `PropertyAccessorObject` — script-made, or IDE-made like pro2193's `Cyclic`) → `IMPLEMENTATION ST`, empty;
    TwinCAT (609 / 613 / 614) → `IMPLEMENTATION ST`, empty.
  - Step 1 numbers: no product code changed. Changed: `scripts/vendor-facts.ts` (read op `fetched`, `WireSide.fetched`,
    `fetch` now under `TIMEOUT_MS`), `scripts/vendor-facts.table.ts` (the op + row `abstract-member-code`), both
    snapshots (only the new row's key), DIALECT C2n (the `[PROBE]` marker + the re-measured facts), `scripts/README.md`.
    volt-cli `bun test test/unit/vendor-facts.test.ts` 54 pass / 0 fail (51 + 3 new); `bun run typecheck` clean;
    Repo.Gates `VendorFact*` 15 pass. No LSP, fixture or transpiler change (fixture map not regenerated).
  - Gate 1 (review findings, both fixed): (1) the "script-made" framing corrected to "the class/slot decides" in 1.3,
    proposal Why/Impact and DIALECT C2n — pro2193's IDE-made `Cyclic` is a slotted `POUMethodObject` (already
    measured, `merged-classes`), so 3.3 expects its one CODESYS line to flip ST → NONE; (2) the SET measured
    (1.1 above): row `abstract-member-code` +3 steps per vendor (`find set`, code + build, empty), +`set` reads.
    Runs: CODESYS 27.0 s `--write` (14 new keys, no committed value changed), 27.7 s "every fact as committed";
    TwinCAT 23.4 s `--write` (17: 11 new keys + the 5 `fetched*` owner texts and `steps` grown by the SET), 25.0 s
    "every fact as committed". Gate: `bun run typecheck` clean (5 packages); volt-cli `bun test test/unit` 78 pass /
    0 fail; `Volt.Repo.Gates` 160 pass; `Volt.Engine.Tests` 2325 pass / 1 skip / 0 fail; `bun run lint` no errors.
    No product, LSP, fixture or transpiler change — the LSP suite and the fixture map are not affected (not run).

## 2. Design

- [ ] 2.1 design.md: the declaration rule (ABSTRACT + no code ⇒ NONE), the push per slot, the creates/renames/retypes it
      now accepts, the code-under-ABSTRACT outcome from 1.1, and the refusals that stay; reviewed against the wire-parity
      rule (identical text for the same declaration on both vendors).

## 3. Fix

- [ ] 3.1 Red tests first: the vendor-parity suite (an abstract method and an abstract property on both bridges pull
      byte-identical text), a CODESYS and a TwinCAT driver test each, the migration case (pro2193-shaped NONE owner
      created into a blank TwinCAT and CODESYS project).
- [ ] 3.2 The fix: the read rule in both drivers, NONE's push per slot, `BodyFormatGuard` (creates/renames/retypes
      accepted; a body under ABSTRACT handled per 1.1), DIALECT C2n rewritten (no divergence left), vendor-facts rows.
- [ ] 3.3 Live: e2e on CODESYS SP21 and TwinCAT (both up, so the vendor-parity suite runs), re-pull pro2193 and check
      exactly its abstract members change; full e2e on both vendors green.
