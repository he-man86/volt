# Tasks: transpile-refusal-classification

Paths are relative to `packages/volt-lsp-iec/`. Filed by `transpile-restructure` (its tasks.md 8.3, review R2).

## 1. Measure

- [ ] 1.1 For each of the 83 `unclassified` codes in `src/transpile/lower/diagnostics/codes.ts`: its `bail` call sites, the
  fixtures that hit it (`map.generated.ts` rows, their recordings) and its corpus count (`scripts/probe-lowering-refusals.ts`).
  - Accept: one table in this file, one row per code, with the kind each piece of evidence points at, or "undecided".

## 2. Classify

- [ ] 2.1 Every code the evidence decides gets its kind; a code whose sites refuse two kinds is split, one code per kind.
  - Accept: `codes.test.ts`'s ratchet lowered to the new count; S `ir,rust` identical (no refusal moves).
- [ ] 2.2 Every undecided code is asked first (fixtures written, then one `record:language` / `record:exec` batch per vendor),
  then classified.
  - Accept: the ratchet at 0 — the `unclassified` kind removed from `LowerCodeKind`; `docs/architecture.md`'s refused lists
    name each code's kind.
