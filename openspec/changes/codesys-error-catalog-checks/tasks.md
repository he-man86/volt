# Status — CODESYS error-catalog checks

_Authoritative data lives in `docs/codesys-reference/error-catalog.json` (per-code `status`/`triage`/`verified`/
`note`) and `TRIAGE.md`. This file is the human overview; regenerate the numbers from the catalog, don't hand-edit them._

## Where we are (2026-07-11)

**131 / 220 documented codes implemented · 112 CS-verified · 112 TC-verified · CS/TC fully reconciled.**
Every implemented code is a registered check in `src/analysis/checks/**` (or a parser-surfaced syntax error),
emitting through `computeSemanticDiagnostics` with per-vendor wording (`messages.ts`), held to the corpus zero-FP
gate. Verified = the message is byte-identical to what the live IDE build emits (recorded 2026-07-11 from CODESYS
`:8556` + TwinCAT `:8555`).

| Bucket | Count | Meaning |
|---|---:|---|
| **implemented** | 131 | a check emits it, burn-in green |
| ├ both-vendor verified | 112 | byte-identical to both live builds |
| └ implemented, not both-verified | 19 | structural ceiling (see "open", not a TODO list) |
| **checkable** (offline, not yet built) | 54 | the open backlog — see below |
| **ide-only** | 35 | impossible offline (live build / library / memory / codegen) — out of scope by design |

The 220 total is **not** the target — 35 are ide-only and ~24 more are deferred-with-reason (below). See
"What 100% means".

## What's done (the machinery)

- **Catalog + triage** — every code seeded from `_toc.json`, harvested (message/category/cause/repro), and
  assigned a `status` + `triage`. `error-catalog.test.ts` burns in every `implemented` code (repro → expect).
- **Live conformance oracle** — `scripts/verify-catalog.ts` builds each repro on a live bridge and compares the
  real IDE diagnostics to ours; `--write` stamps `verified.<vendor>`. This is what catches a false positive the
  offline corpus can't (it demoted C0371, reclassified C0036).
- **CS/TC reconciliation (2026-07-11)** — every CS-verified code is resolved on TwinCAT: verified on both, or
  classified `codesysOnly` (7 — TC's compiler genuinely lacks the rule), `twincatWordingDivergence` (2 — TC's own
  message is buggy/truncated; we keep the correct wording), or `twincatInternalError` (1 — TC crashes; we emit the
  CODESYS error). Each is documented in the catalog `note`.

## What's open and why (the 54 `checkable`)

| `triage` | Count | Why open | Do it? |
|---|---:|---|---|
| **resolution** | 30 | needs cross-symbol / type-graph resolution (callee signature, inheritance, generics, overloads, dataflow) with a real FP surface | ✅ **the only genuine headroom** — per-code, human-gated, verified live |
| **parser** | 11 | CODESYS's *exact* recovery wording for a syntax error — reproducing it needs statement/decl-body parsing that inverts the single-source design | ⚠ deferred, marginal value |
| **optionGated** | 6 | flips on a compiler option we can't see offline (Replace-constants, strict enums) → always-on ⇒ FP | ✗ would FP |
| **pragma** | 4 | pragma operand/value validation — FP-prone against vendor/library pragmas | ⚠ deferred |
| **skip** | 2 | no offline ground truth, or CODESYS accepts it | ✗ |

**The 19 implemented-but-not-both-verified** are a ceiling, not a backlog: parser-bucket codes where the live IDE
emits nothing on the repro or uses a semantic (non-token) message (C0002/08/10/11/15/27/31/173/189/211/213),
semantic-alias codes where the IDE reports the same defect under a *different* `Cnnnn` (C0130/144/145/149), and
env-blocked cases (C0454 needs a `__NEW` memory pool). Reproducing these means matching IDE internals we
deliberately don't mirror.

## What "100%" means (define the denominator)

"100% of 220" is the wrong goal — 35 ide-only + ~24 deferred codes are out of offline scope by construction. Two
honest targets:

1. **Coverage ceiling ≈ 161** = 131 implemented + the 30 `resolution` codes (minus corpus demotions). Closing the
   coverage gap = **implementing the resolution bucket**, one family at a time, each corpus- and live-verified.
   That is the only remaining real work. The other 24 checkable (parser/optionGated/pragma/skip) stay unimplemented
   for principled reasons, not neglect.
2. **Verification ceiling ≈ 112 + a few** = every implemented code confirmed byte-identical live. We're at 112/131;
   the 19 residuals are structural (above), so this is near its true ceiling already.

**So: closing the gap to 100% = working the 30-code `resolution` bucket.** Approach (proven this session on C0178/
C0036): scout the pattern's corpus firing first (`scripts/resolution-scout.ts`) to reject option-gated/FP-prone
candidates before writing code, implement conservatively (skip unknown/library types → zero-FP), then verify the
exact wording live on both bridges. Each family is a judgment call — do it with a human, not on an autonomous loop.

## Open task list

- [ ] Work the `resolution` bucket (30 codes) per the approach above — this is the coverage gap to 100%.
- [ ] Optional: re-triage the 24 deferred `checkable` codes to a terminal status so the "54 checkable" stops
  implying they're all TODO (they aren't).
- [x] Everything else (catalog, triage, harvest, conformance harness, live CS+TC verification, CS/TC
  reconciliation) — **done**; see the catalog for per-code detail.
