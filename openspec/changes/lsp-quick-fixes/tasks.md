## 0. Census and design

- [ ] 0.1 Every diagnostic code: frequency on the six corpora and the fixtures, the user's fixing edit, class (mechanical /
      choice / no fix). Navigation breadth (workspace symbols, call hierarchy, rename across libraries) measured on the
      corpora: what is answered, what is missing.
- [ ] 0.2 design.md: the fix model (`DiagnosticItem.fixes`, produced by the reporting check; `code-actions.ts` renders), the
      fixes to build in census order, the proof rule (compiler-recorded), source actions worth building, the breadth gaps to
      fix vs file.

## 1. Red first

- [ ] 1.1 Per planned fix: a fixture BEFORE (the diagnostic) and the expected AFTER text; the AFTER recorded with
      `record:language` on CODESYS (and TwinCAT where the code applies) — it must build clean; a test that the action
      produces exactly that text. Red until the fix exists.

## 2. Build

- [ ] 2.1 The fix model; the existing conversion wrap moved onto it.
- [ ] 2.2 The fixes, in census order, each green against its recorded AFTER.
- [ ] 2.3 Source actions and "fix all in file" where 0.2 chose them.
- [ ] 2.4 The cheap navigation-breadth gaps; the rest filed with their measurement.

## 3. Close

- [ ] 3.1 Coverage: share of corpus diagnostics (by occurrence) that now offer a fix, before/after. Docs (`docs/behavior.md`
      or the services section of architecture.md); full suite cold green; archive.
