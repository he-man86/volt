## Why

For anyone who did not write the transpiler, **the refusal is the product**: 82% of corpus bodies end in one
(`lower/diagnostics/codes.ts`, `scripts/lower-completeness.ts`: 250 of 304 POUs with code), and its code is what tells a user
which of three things to do — fix the ST (`invalid`: CODESYS refuses it too), wait or ask (`not-modelled`: valid ST, understood,
not built), or record it (`not-measured`: valid ST whose behaviour no recording states). On 2026-10-11, **83 of the registry's 140
codes are still `unclassified`** (invalid 24, not-modelled 14, not-measured 19). Every code `transpile-restructure` added is
classified; the older ones were left `unclassified` on purpose — classifying by reading call sites alone would be the confident
guessing the registry exists to stop — and `codes.test.ts` holds the count as a ratchet that only falls.

`transpile-restructure` filed this as its final review's R2 (tasks.md 8.3, 2026-10-10 and 2026-10-11): a change of its own,
because each code needs its call sites read AND, where a code's kind is not evident from them, a recording that decides it.

## What Changes

- Each `unclassified` code gets its kind from evidence: its call sites (what the refusal guards), the fixtures that hit it
  (`map.generated.ts` `not-lowered` and `refused` rows, their recordings), and the corpora (`scripts/probe-lowering-refusals.ts`).
  A code whose call sites refuse more than one kind of thing is split into one code per kind.
- A code no recording decides is asked first (`record:language`, `record:exec`, one batch per vendor) — never classified by
  reading alone.
- The ratchet in `codes.test.ts` falls with each batch, to 0.

## Non-goals

- No refusal is lifted: what lowers and what is refused stays exactly as it is (S `ir,rust` identical), only the kind a code
  reports changes (and a split code's slug).
- No message rewording beyond what a split needs.

## Impact

- `packages/volt-lsp-iec/src/transpile/lower/diagnostics/codes.ts` (and `codes.test.ts`'s ratchet), the `bail` sites of a split
  code, `docs/architecture.md`'s refused lists.
- New fixtures and recordings only where a kind is undecided.
