Requires: `ld-fbd-coverage` archived. Spec only until then — do not start.

## 1. Map

- [ ] 1.1 Per project: what it owns (ARCHITECTURE.md, README) vs what its code does; list misplaced code, duplicated
      logic between the hosts, and cross-project leaks. Merge with the 2026-10-16 simplify reviews (what is left).
      Open question for 1.2 (owner, 2026-10-17, not decided): the translation model → NWL nodes is done twice, once per
      driver (`CodesysNetworkWriter` 875 lines; `TcArchiveBuilder` + `TcNetworkWriter` 1660) although the NWL model is
      identical on both vendors (DIALECT N1). NWL is the CODESYS family's format, not vendor-neutral — a future vendor
      (Siemens, Rockwell) has no NWL — so the Engine core stays at `NetworkModel`. Proposal: one shared CODESYS-family NWL
      layer (model → NWL description) used by both drivers, each driver only placing it (live objects / XmlArchive).
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
