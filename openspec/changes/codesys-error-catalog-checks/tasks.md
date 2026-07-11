# Status — CODESYS error-catalog checks

_Authoritative data lives in `docs/codesys-reference/error-catalog.json` (per-code `status`/`triage`/`verified`/
`note`) and `TRIAGE.md`. This file is the human overview; regenerate the numbers from the catalog, don't hand-edit them._

## Where we are (2026-07-11)

**137 / 220 documented codes implemented · 112 CS-verified · 112 TC-verified · CS/TC reconciled.**
Every implemented code is a registered check in `src/analysis/checks/**` (or a parser-surfaced syntax error),
emitting through `computeSemanticDiagnostics` with per-vendor wording (`messages.ts`), held to the corpus zero-FP
gate. Verified = the message is byte-identical to what the live IDE build emits (recorded 2026-07-11 from CODESYS
`:8556` + TwinCAT `:8555`).

| Bucket | Count | Meaning |
|---|---:|---|
| **implemented** | 137 | a check emits it, burn-in green |
| ├ both-vendor verified | 112 | byte-identical to both live builds |
| └ implemented, not both-verified | 25 | 19 structural-ceiling + 6 new this session, pending a live recording |
| **checkable** (offline, not yet built) | 48 | the open backlog — see below |
| **ide-only** | 35 | impossible offline (live build / library / memory / codegen) — out of scope by design |

The 220 total is **not** the target — 35 are ide-only and ~24 more are deferred-with-reason (below). See
"What 100% means".

### Resolution-bucket progress (this session)

Worked the `resolution` bucket per the proven scout→implement-conservatively→corpus-gate→colocated-test flow.
Closed **6** (corpus zero-FP + burn-in green; wording PROVISIONAL until a live recording):
- **C0179** `fb-init-inout` — inline FB-init field cannot target a VAR_IN_OUT.
- **C0511** `abstract-assign` — value-assign (`:=`) into a (reference to a) project abstract FB (REF= / pointer excluded).
- **C0266** `loop-exit` — FOR whose end bound is at/beyond the counter type's range → unreachable exit (endless loop).
- **C0136** `ambiguous-global` — bare ref to a global declared in 2+ **project** GVLs (library GVLs excluded — they
  flatten into project scope and manufacture false duplicates: corpus scout found 60+ library dups, 0 project dups).
- **C0237 + C0236** `external-global` — a VAR_EXTERNAL with no matching VAR_GLOBAL, or a type mismatch against one.

**The resolution bucket is now fully triaged** — the 24 codes still `checkable` all carry a terminal deferral
reason in the catalog `note` (no more "quietly TODO"): FP-prone (C0042 mixed-args, C0062 bit-access), needs
system/library knowledge (C0207 __SYSTEM, C0239/C0567 IQueryInterface, C0065 leading-dot-global), model-blocked
(C0508 action-scope, C0576 method-member, C0138/C0581/2/3 overload resolution, C0564/572 init-order, C0540
no_assign propagation, C0043), uncertain-semantics-needs-live (C0316 SUPER^.FB_Init chaining), niche AST (C0183,
C0186, C0187), or parked (C0573 metadata-sync, C0585/6/7 generics). None is a clean zero-FP offline win today.

Also: a **perf** fix — `staticScopeType`/`findChildScope` did an O(children) linear scan per lookup; on a real
project the root scope has thousands of children, so every bare-ident inference + named-type resolution was a 1×n
tax. Routed both through a lazy name→children index (`childScopesByName`). Full corpus diagnostic pass 138s→81s;
the corpus gate that was timing out now passes. And the burn-in harness gained `reproFiles` (cross-file repros).

**Deferrals discovered (blocked by a model gap, not neglect — recorded in each code's catalog `note`):**
- **C0508** (var==action name) — a standalone action binds at PROJECT scope in the one-item-per-file layout, so it
  never co-locates with the FB's vars; needs action→FB name association.
- **C0576** (external VAR_INST access) — `fb.method.varInst` infers the method's return type, not a scope with the
  VAR_INST; needs bespoke method-member resolution.
- **C0062** (member on non-struct) — reaffirmed FP-trap: `word.bitConst` symbolic bit access is valid and
  indistinguishable without member-as-constant resolution (20 valid corpus hits).

**Overloads / init-order decision (the juncture the plan named):** corpus scout found **0 overloaded method names
across all 5 projects** → **defer C0581/582/583** (and init-order C0564/572) — real projects don't use them, and
they need genuine new resolution structure. Revisit if a real project adopts overloads.

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

1. **Coverage ceiling ≈ 157** = 135 implemented + the ~22 `resolution` codes that are actually implementable
   (the 26 still-checkable minus the model-blocked C0508/C0576/C0062 and the deferred overloads/init-order).
   Closing the gap = working that implementable subset, one family at a time, each corpus- and live-verified.
2. **Verification ceiling ≈ 112 + a few** = every implemented code confirmed byte-identical live. We're at 112/135;
   the 23 residuals are the 19 structural + this session's 4 new (pending a live recording on the bridges).

**Approach (proven this session):** scout the pattern's corpus firing first (`scripts/resolution-scout.ts` +
ad-hoc scouts) to reject option-gated/FP-prone/model-blocked candidates before writing code, implement
conservatively (skip unknown/library types → zero-FP), corpus-gate, colocated-test, then verify the exact wording
live on both bridges. Each family is a judgment call.

## Open task list

- [ ] **Live-verify this session's 4 new codes** (C0179/C0511/C0266/C0136) on the `:8556`/`:8555` bridges and stamp
  `verified` + finalize the PROVISIONAL wording. Highest-value next step (bridges required).
- [ ] Continue the implementable `resolution` remainder (e.g. C0237/C0236 VAR_EXTERNAL, C0239/C0567 interface-IQI,
  C0187) — cheap + safe but low real-world surface (zero corpus firing); close for catalog completeness.
- [ ] **Model work (only if a real project needs it):** action→FB association (unblocks C0508), method-member
  scope (unblocks C0576), overload resolution (C0581/2/3) — deferred; corpus shows 0 usage.
- [x] Catalog, triage, harvest, conformance harness (+ `reproFiles` cross-file support), live CS+TC verification,
  CS/TC reconciliation, the O(children) hot-path perf fix, and 4 resolution codes — **done**; see the catalog.
