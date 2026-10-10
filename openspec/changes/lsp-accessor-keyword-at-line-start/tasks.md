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

- [ ] 2.1 Conformance fixtures, each built clean in CODESYS (recorded): the operand shapes of 1.1 in a property, plus
      `GET := 1;` where `GET : INT` is declared; controls as 1.1. Record today's LSP output.
- [ ] 2.2 Red: no accessor diagnostics on the operand fixtures; controls unchanged.
- [ ] 2.3 Fix: the same scope rule — `collectAccessorBody` after the accessor's `IMPLEMENTATION` stops only at its own
      END, `END_PROPERTY` or the other accessor's END (then "not closed by END_GET", as today); `GET`/`SET` inside its
      VAR blocks are names. `refuseNotFirstOnLine` and the bare-accessor refusal unchanged.
- [ ] 2.4 Full LSP suite and conformance recordings green, no new divergences. Run after transpile-restructure closes
      (shared suite).

## 3. Close

- [ ] 3.1 Tell PLCAssist: both halves fixed, the build that carries them; `SET`/`GET` names need no rename.
