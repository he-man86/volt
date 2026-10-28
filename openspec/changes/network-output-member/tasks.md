## 1. Census and design

- [ ] 1.1 Count on the models (scratch, as network-text-st 1.1): every box shape the rule must spell — ENO shown and
      unwired while the value chains; ENO shown and not chained at a root; EN shown on an FB; an FB with one output;
      a box at a root (no chaining output: no `.X`); `Dryer`/`WSM`-like callees declaring their own `EN`/`ENO`. Decide
      each spelling from the counts; a shape with no spelling is listed, not hidden.
- [ ] 1.2 design.md: the rule, the member names (`OUT` for a function's value, the declared name for an FB output,
      `ENO`), when `.X` is required (more than one output can chain) and when it is refused (only one can), a declared
      `EN`/`ENO` pin vs the shown EN/ENO, the root rule; measured in CODESYS through the exec twin where behaviour is
      new.

## 2. Build

- [ ] 2.1 C# writer + reader (`StNetworkWriter`/`StNetworkReader`): one name per box, `EN :=`, `.X`, `FB :=`; suffixes
      and the FB statement form deleted. Round-trip oracle on the corpora, TwinCAT archives and accept cases: tallies
      no worse than network-text-st's (CODESYS corpora 0 `%UNSUPPORTED`), 0 gaps. The case set re-spelled.
- [ ] 2.2 LSP: one signature per box, `.X` typed from the declaration, the subset check updated; agrees with the C#
      reader on every accept and refuse case.
- [ ] 2.3 Exec twin: translate `.X`, `EN :=`, `FB :=` to ST; twin builds re-recorded live (lenze-mid, pro2193): 0
      errors; exec traces equal on the spelled cases.
- [ ] 2.4 `docs/network-text.html`: the suffix table becomes one sentence and one example; the FB rows follow the rule.
      Fix the stale anchors: `test/e2e/graphical/roundtrip.test.ts:53` (`#opaque`, LET/`i*`), the LSP conformance
      fixtures `graphical/network-unresolved.ts`, `network-graphical-a.ts`, `network-graphical-c.ts` (`#unnamed-instance`,
      `#sink`, `#eneno`, `#fb`, `#group`, `#operator-group--…`, `#execute-box--…`), `NetworkModel.cs:167`.
- [ ] 2.5 Live e2e on CODESYS and TwinCAT; the graphical conformance fixtures re-recorded.

## 3. Close

- [ ] 3.1 Cold full suites, the small release matrix (latest CODESYS + TwinCAT), archive.
