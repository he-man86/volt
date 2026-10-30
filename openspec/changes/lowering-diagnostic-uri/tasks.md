> DRAFT, written from Sim-Assist. Built.

## 1. Diagnostic shape

- [x] 1.1 `LowerDiagnostic.uri` for every lowering diagnostic (main file, library files, Standard): every `Lowering` names its file (`Lowering.uri` — its scope's, or, in the project's scope, the one its maker passes: a GVL's declarations, a METHOD's VAR_STAT, a type's layout by its declaring symbol), and `lowerDiagnostic` throws `LoweringBug` for a refusal in no file. A refusal whose cause is another file's names that file: a body or routine refused at itself (`graphical-body`, `parse`, `pragma-undecided`, `call-library`, `base-unresolved`), a type at its declaration (`layout-*`), a slot no backend holds at its declaration (`IrSlot.origin`, `storageRefusal`), a GVL instance whose init the step does not walk at that instance (`attr-init-unreached`), an alias type's own initializer at itself (`Lowering.inFile`). `IrPou.unlowered` carries the same `uri` and `span`
- [x] 1.2 `graphical-body` once per POU, at the POU in its own file; no `call-body` for the same cause: a failed body or routine keeps its refusals and every later call reports the same diagnostics again (`calls/routines.ts` `again`), which `lowerUnit` states once; `call-body` stays only for a failure whose refusal is not this POU's (a quiet build's)

## 2. Test

- [x] 2.1 The repro of proposal.md: one diagnostic, `uri` `FB_L.pou`, span at `FB_L` in `FB_L.pou` (`lower/diagnostics/diagnostic.test.ts`)
- [x] 2.2 Two instances of `FB_L`: still one diagnostic
- [x] 2.3 A positional-call refusal inside a second POU file carries that file's `uri`

## 3. Consumers

- [ ] 3.1 Sim-Assist regenerates its bundle and removes the message parsing in `attributeLowering`

## 4. Class sweep

- [x] 4.1 Every code, by a check rather than a list: `lowerSource` checks EVERY answer it gives (`misplaced`, `lower/diagnostics/diagnostic.ts`) — each diagnostic's uri is one of the lowering's files and its span a span of that file, else `LoweringBug` — so every lowering of the suite (6668 fixtures, every test snippet, the library tests) is the gate; the corpus gate asks the same of every corpus POU (`incoherent`, `test/corpus/support/walk.ts`). It found three wrong sites, fixed: a type's refusal at its declaration in the caller's file (`layout-struct`, lenze-mid), a layout built from one library's declaration in another library's scope (`aggregate-init`, lenze-mid), and an alias type's initializer (found by a pin). Codes reached: 130 over the fixtures, 132 over the corpus; the 35 no fixture or corpus program produces are covered wherever a unit test lowers them through `lowerSource`
- [x] 4.2 Per code, the cross-file cases coherence cannot tell apart (`diagnostic.test.ts`): main source (`string-non-ascii`), a second POU (`call-positional`), a METHOD's and a FUNCTION's own file, a GVL declaration, a DUT field (`slot-unknown`), an alias type's initializer as a variable and as an element, a GVL FB instance's init (`attr-init-unreached`), Standard (`call-library` at TON in the library's file), another file's parse error
