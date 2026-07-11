# Status — CODESYS error-catalog checks

_Authoritative data lives in `docs/codesys-reference/error-catalog.json` (per-code `status`/`triage`/`verified`/
`note`) and `TRIAGE.md`. This file is the human overview; regenerate the numbers from the catalog, don't hand-edit them._

## Where we are (2026-07-11)

**136 / 220 documented codes implemented · 117 CS-verified · 116 TC-verified.**
This session added 6 checks and ran them (plus the whole catalog) against BOTH live bridges `:8556`/`:8555`, which
is what makes the numbers trustworthy — it caught two false positives offline testing had missed (C0236, C0215,
both removed) and pinned per-vendor wording deltas (C0136 "Ambiguous"/"ambiguous", C0266 "loop."/"loop!").
Every implemented code is a registered check in `src/analysis/checks/**` (or a parser-surfaced syntax error),
emitting through `computeSemanticDiagnostics` with per-vendor wording (`messages.ts`), held to the corpus zero-FP
gate. Verified = byte-identical to the live IDE build; the catalog `verified` field is authoritative (the
`messages.ts` comments defer to it).

| Bucket | Count | Meaning |
|---|---:|---|
| **implemented** | 136 | a check emits it, burn-in green |
| ├ both-vendor verified | 116 | byte-identical to both live builds (incl. 4 new this session) |
| ├ CODESYS-only (TC lacks the rule) | 1 | C0511 abstract-assign — CODESYS-gated |
| └ implemented, not both-verified | 19 | structural-ceiling residuals |
| **checkable** (offline, not yet built) | 49 | the open backlog — see below |
| **ide-only** | 35 | impossible offline (live build / library / memory / codegen) — out of scope by design |

The 220 total is **not** the target — 35 are ide-only and ~24 more are deferred-with-reason (below). See
"What 100% means".

### Resolution-bucket progress (this session)

Worked the `resolution` bucket via scout→implement-conservatively→corpus-gate→colocated-test→**live-verify**.
Closed **6**, all corpus zero-FP + burn-in green:
- **C0179** `fb-init-inout` — inline FB-init field cannot target a VAR_IN_OUT (live: the IDE says "is no **input** of").
- **C0511** `abstract-assign` — value-`:=` into a (ref to a) project abstract FB. **CODESYS-only** (TwinCAT lacks
  the rule → the check is `vendor === "codesys"`-gated so it can't FP on TC).
- **C0266** `loop-exit` — FOR whose end bound is at/beyond the counter type's range → unreachable exit (endless loop).
- **C0136** `ambiguous-global` — bare ref to a global declared in 2+ **project** GVLs (library GVLs excluded —
  corpus scout: 60+ library dups, 0 project dups).
- **C0237** `external-global` — a VAR_EXTERNAL with no matching VAR_GLOBAL.
- **C0582** `duplicate-method` — two same-name methods in one FB (unmarked overload). Not bridge-verifiable (the
  push is rejected), but valuable: it guards the silent bridge data-loss path (see the bridge guard below).

**Two false positives removed by live verification** (offline alone would have shipped them):
- **C0236** (VAR_EXTERNAL type mismatch) — live IDE builds it clean, so it was never an error.
- **C0215** (persistent direct-address) — live IDE builds every persistent+`AT` variant clean; the documented rule
  applies only to the special Persistent-Variables object, which is indistinguishable from a persistent GVL offline.

**Bridge guard** (`packages/volt-bridge`, shared Core): a push whose source has two same-name children silently
overwrote the first (name-keyed, `accepted:true`, a source method lost). Now rejected with a clear reason —
parity-verified via a Core unit test + byte-identical live rejection on CODESYS and TwinCAT.

**Perf**: `staticScopeType`/`findChildScope` did an O(children) linear scan per lookup — a 1×n tax on every
bare-ident inference + named-type resolution (root scope has thousands of children). Routed through a lazy
name→children index (`childScopesByName`); full corpus diagnostic pass 138s→81s. Burn-in harness gained
`reproFiles` (cross-file repros); `verify-catalog` gained cross-file push.

**Full live audit — the resolution bucket + every CS-unverified check is now fully triaged.** Ran the whole
catalog against live CODESYS; every implemented check that isn't CS-verified was confirmed a real detection, not
an FP, with the reason recorded per-code:
- **bridge-blocked** (the bridge rejects the invalid construct before the IDE compiles it — the LSP guards it
  early): C0098, C0144, C0145, C0149, C0582.
- **semantic-alias** (IDE errors under a different code; our wording is often clearer): C0130, C0224.
- **env-gated** (masked by an environment error, documented rule, conservative): C0454.
- **parser** (IDE recovers a syntax error with a semantic message ours can't mirror; covered by the corpus
  build-conformance gate): C0002/08/10/11/15/27/31/173/189/211/213.

The remaining `checkable` codes carry a terminal deferral reason in the catalog `note` (no "quietly TODO"):
FP-prone (C0042 mixed-args → live shows the IDE emits C0044; C0062 bit-access), needs system/library knowledge
(C0207 __SYSTEM, C0239/C0567 IQueryInterface, C0065 leading-dot-global), model-blocked (C0508 action-scope, C0576
method-member, C0138/C0581/C0583 overload resolution — **structurally unrepresentable in Volt's name-as-identity
wire**, C0564/572 init-order, C0540 no_assign, C0043), uncertain-but-live-checked (C0316 SUPER^.FB_Init chaining →
builds clean), niche AST (C0183/C0186/C0187), or parked (C0573 metadata-sync, C0585/6/7 generics). The deeper
detail per code (why C0508/C0576 are model-blocked; the 0-overload corpus scout behind deferring C0138/C0581/3)
lives in each code's catalog `note`.

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
| **resolution** | 21 | needs cross-symbol / type-graph resolution (callee signature, inheritance, overloads, dataflow) — all now deferred-with-reason (see above); model-blocked or structurally unrepresentable | ⚠ per-code judgment, mostly blocked |
| **parser** | 11 | CODESYS's *exact* recovery wording for a syntax error — reproducing it inverts the single-source design | ⚠ deferred, marginal value |
| **optionGated** | 6 | flips on a compiler option we can't see offline (Replace-constants, strict enums) → always-on ⇒ FP | ✗ would FP |
| **pragma** | 4 | pragma operand/value validation — FP-prone against vendor/library pragmas | ⚠ deferred |
| **skip** | 6 | no offline ground truth, or the live IDE accepts it (incl. C0236/C0215/C0042/C0316 — live-confirmed) | ✗ |

**The 19 implemented-but-not-CS-verified** are a ceiling, not a backlog — all live-audited this session as real
detections (not FPs): parser codes where the IDE recovers with a semantic message (C0002/08/10/11/15/27/31/173/
189/211/213), bridge-blocked codes where the push is rejected before compile (C0098/144/145/149/582), semantic-
alias codes reported under a different `Cnnnn` (C0130/224), and env-gated C0454. Byte-matching these means
mirroring IDE internals (or the CODESYS object model) we deliberately don't — see the design note below.

## What "100%" means (define the denominator)

"100% of 220" is the wrong goal — 35 ide-only + the deferred `checkable` codes are out of offline scope by
construction. The honest state:

1. **Coverage** — 136 implemented. The remaining `resolution` codes are all deferred-with-reason (model-blocked,
   FP-prone, or needs system/library knowledge), so there is **no clean offline headroom left**; more coverage
   needs model structure the corpus shows real projects don't use (overloads: 0 across 5 projects).
2. **Verification** — 117 CS-verified · 116 TC-verified. The full catalog was swept against both live bridges;
   the 19 CS-unverified are the structural ceiling above (each a confirmed real detection, reason recorded).

**Design note (why byte-matching has a ceiling):** the un-verifiable checks are mostly *bridge-blocked* — Volt's
name-as-identity wire can't transmit the invalid construct, so the IDE never emits its message for us to record.
Mirroring the full CODESYS object model to fix that would trade away git-native / text / AI-editability (Volt's
reason to exist) to gain a handful of rare constructs (overloads — which TwinCAT doesn't support anyway). So the
LSP check *is* the right tool at that boundary: it turns a cryptic push rejection into a clear, early error.

## Open task list

This change is effectively **complete**. Remaining work is optional and needs an external trigger:

- [ ] **Model work — only if a real project needs it:** action→FB association (unblocks C0508), method-member
  scope (C0576), overload resolution (C0581/3) — deferred; corpus shows 0 usage and overloads are unrepresentable
  in the wire.
- [ ] Optional low-value completeness: niche codes with zero corpus surface (C0239/C0567 interface-IQI, C0187).
- [x] **Done:** catalog + triage + harvest; conformance harness (+ `reproFiles` cross-file); 6 new checks
  live-verified on both bridges; 2 FPs removed (C0236/C0215); the bridge duplicate-child guard; the O(children)
  perf fix; the full live catalog audit; `messages.ts` comments synced to the catalog's `verified` truth.
