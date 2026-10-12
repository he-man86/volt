## 1. Bridge (`StReader`, both vendors)

- [x] 1.1 Red tests (`test/Volt.Engine.Tests/format/st/AccessorKeywordOperandTests.cs`): `SET`/`GET` as operands at a
      line start in an accessor body (`SET^ :=`, `SET^.x :=`, `SET :=`, `SET.x :=`, `SET[1] :=`, `SET(IN := …)`,
      `GET.x :=`) and `SET : INT;` in an accessor's VAR block read into the right accessor, no refusal; a body that
      reaches `END_PROPERTY` / `END_SET` before its `END_GET` is refused naming both lines; controls: bare `GET` closed
      by the next `SET`, `GET PUBLIC` / `GET (* note *)` / `SET // note` still refused as text after the keyword.
- [x] 1.2 Fix: `ReadProperty` scans by scope — inside an accessor's body (after its `IMPLEMENTATION` line) only its
      own END closes it, inside its VAR blocks no accessor keyword counts.
      Done 2026-10-10: engine 2307 green. The `ChildSplitterTableTests` row "a SET-led line inside a getter's body"
      flipped from a refusal to a read: its premise contradicted the measured soft-keyword fact (SET is a legal name,
      CODESYS compiles it), not a code behaviour. Found on the way: the old scan closed a getter WITH a body but no
      END_GET as bare and dropped the body — now refused.
- [x] 1.3 Live: `test/e2e/items/accessor-keyword-operand.test.ts` — a FB with `SET : POINTER TO INT` / `GET : INT` and
      accessor lines `SET^ := P;`, `GET := P;` round-trips exactly and builds on CODESYS and TwinCAT; full e2e on both.
      Done 2026-10-10: full e2e CODESYS SP21 347 pass / 0 fail, TwinCAT 346 pass / 0 fail.

## 2. LSP

- [x] 2.1 Conformance fixtures, each built clean in CODESYS (recorded): the operand shapes of 1.1 in a property, plus
      `GET := 1;` where `GET : INT` is declared; controls as 1.1. Record today's LSP output.
      Done 2026-10-11: 12 `unit_accessor_name_*` fixtures in `fixtures/grammar/units.ts` (pushed as sent, every body under
      its IMPLEMENTATION line): `SET^ :=`, `SET^.x :=`, `SET :=`, `SET.x :=`, `SET[1] :=` in a setter, `P := ADR(SET^.x);`
      mid-line in a getter, `GET := 7; P := GET;`, `GET := P;` in a setter, `SET : INT;` in a getter's VAR block, the
      struct they use, and two controls (both accessors closed; a bare GET closed by the SET under it). record:language:
      all 12 build with 0 errors / 0 warnings on CODESYS SP21 and TwinCAT (Project13); record:exec: 11 confirmed, 1
      not-lowered (`_getter_adr`, a property returning a pointer). Today's LSP: 0 parse errors on the controls, 2-6 on
      each of the 9 operand fixtures ("'GET' is not closed by 'END_GET'", "'SET' does not start its line", "'^' shares
      the line of 'SET'").
- [x] 2.2 Red: no accessor diagnostics on the operand fixtures; controls unchanged.
      Done: four tests in `parse/units/property.test.ts`; before the fix the operand and VAR-block tests failed (2 of 4),
      the unclosed-body and control tests passed.
- [x] 2.3 Fix: the same scope rule — `collectAccessorBody` after the accessor's `IMPLEMENTATION` stops only at its own
      END, `END_PROPERTY` or the other accessor's END (then "not closed by END_GET", as today); `GET`/`SET` inside its
      VAR blocks are names. `refuseNotFirstOnLine` and the bare-accessor refusal unchanged.
      Done: `collectAccessorBody` — under the IMPLEMENTATION line it consumes to its own END (the other END is consumed
      as not closed), stops at END_PROPERTY; before the line the next GET/SET still closes it (bare). The VAR blocks
      already read GET/SET as names. A getter reaching the setter's lines also reports the setter's IMPLEMENTATION line
      as a second one in the getter's body — the two messages name both lines.
- [x] 2.4 Full LSP suite and conformance recordings green, no new divergences. Run after transpile-restructure closes
      (shared suite).
      Done 2026-10-11: `VOLT_REQUIRE_FULL=1 bun test` 9428 pass / 0 fail / 35 skip / 389 todo; typecheck and lint
      clean; LSP-only 0 fixtures on both vendors, exact agreement CODESYS 5121/5603, TwinCAT 5002/5603. Baselines moved
      by counts only (the 12 fixtures: e.g. "builds, no LSP parse error" 3235 → 3247 / 2993 → 3005, no finding);
      `RENAMED_TARGETS` 536 → 538 (the image class, read). Found on the way: the notes gate read
      transpile-restructure's tasks.md from `changes/`, gone with its archive — pointed at the archive.

## 3. Close

- [x] 3.1 Tell PLCAssist: both halves fixed, the build that carries them; `SET`/`GET` names need no rename.
      Done 2026-10-12: a note for PLC Assist in its repo, `docs/VOLT_UPDATE_2026-10-12.md` (owner: "make a note for
      plcassist that he can read") — both halves fixed in 0.1.17512, the rename can be undone, plus the other changes since
      its pinned Volt commit.
