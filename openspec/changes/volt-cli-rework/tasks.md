Requires: `ld-fbd-coverage` archived. Spec only until then — do not start.

## 1. Map

- [ ] 1.1 Per project: what it owns (ARCHITECTURE.md, README) vs what its code does; list misplaced code, duplicated
      logic between the hosts, and cross-project leaks. Merge with the 2026-10-16 simplify reviews (what is left).
- [ ] 1.2 Owner review of the map: which projects are refactored, which (if any) reimplemented.

## 2. Find (parallel per project, each finding adversarially verified)

- [ ] 2.1 Legacy: code/comments/docs of removed designs and old formats.
- [ ] 2.2 Hidden bugs: masking fallbacks, silent defaults, untested branches — a failing test per bug.
- [ ] 2.3 Hidden features: behaviour no doc or test states — owner decides document+test or delete.

## 3. Rework (project by project, test-first)

- [ ] 3.1 Move misplaced code to its owning project; delete legacy; fix each bug behind its test.
- [ ] 3.2 Reimplement only the projects the owner approved in 1.2, behind the same tests.
- [ ] 3.3 Every step: full C# suites + TS e2e on both vendors; the wire byte-identical before/after.

## 4. Close

- [ ] 4.1 ARCHITECTURE.md / DIALECT.md / READMEs match the code; final placement review; archive.
