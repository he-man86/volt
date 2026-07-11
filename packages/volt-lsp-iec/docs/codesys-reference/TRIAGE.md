# CODESYS error-catalog triage

Which of the 220 documented `Cnnnn` codes the LSP can check **offline** (its whole job), and what each still needs.
This is the map that keeps catalog work batched-by-tier instead of code-by-code (see `error-catalog.json`,
`src/reference/error-codes.ts`, and the burn-in `error-catalog.test.ts`).

Regenerate the tier split, the "already matches" scan, and corpus false-positives with:

```
bun scripts/corpus-fp.ts        # tally error-severity FPs by check code across the corpus (the zero-FP oracle)
```

## The buckets

> **Machine source of truth (2026-07-10):** every open code now carries a one-word `triage` tag + a `note` in
> `error-catalog.json` (`triage: "parser" | "pragma" | "resolution" | "optionGated" | "ideOnly" | "skip"`), and
> genuinely-not-offline codes are `status: "ide-only"` (the burn-in test `test.skip`s them). The lists below are a
> regenerable view of that field — **the catalog is authoritative** (this doc is refreshed from it, it does not
> lead). Regenerate the split by grouping the catalog on `status` + `triage`.

**Current state: 109 implemented · 35 ide-only · 76 open offline backlog (220 total).**

| Bucket | `triage` | Meaning — what's open and why | Do it? | Count |
|--------|----------|-------------------------------|--------|------:|
| **implemented** | — | a check emits it, burn-in green | ✅ done | 109 |
| **resolution** | `resolution` | needs cross-symbol / type-graph resolution (callee signature, inheritance chain, global/external, generics) with real FP surface | per-code human design call | 35 |
| **parser** | `parser` | a syntax/decl-structure error — the syntax layer already emits a recovery diagnostic; exact CODESYS wording needs body/decl parsing (inverts single-source design) | ⚠ deferred, low value | 30 |
| **ide-only** | `ideOnly` | needs live build / memory / device / codegen / library internals | ✗ out of scope (IDE authoritative) | 35 |
| **option-gated** | `optionGated` | flips on a compiler option the LSP can't see offline (Replace-constants, strict enums); always-on ⇒ FP | ✗ corpus-demoted | 5 |
| **pragma** | `pragma` | pragma operand/value validation — needs the known-attribute/operand model; FP-prone vs vendor/library pragmas | ⚠ deferred | 4 |
| **skip** | `skip` | no offline ground truth, or won't-fix (CODESYS accepts it) | ✗ | 2 |

**The 76-code offline backlog, by bucket** (the "todo" set; ide-only is out of scope):
- **resolution (35):** C0035 C0036 C0042 C0043 C0062 C0065 C0136 C0138 C0178 C0179 C0183 C0186 C0187 C0207 C0236 C0237 C0239 C0266 C0316 C0371 C0441 C0508 C0511 C0540 C0564 C0567 C0572 C0573 C0576 C0581 C0582 C0583 C0585 C0586 C0587
- **parser (30):** C0002 C0005 C0006 C0007 C0008 C0009 C0010 C0011 C0013 C0015 C0020 C0026 C0027 C0030 C0031 C0050 C0114 C0115 C0116 C0117 C0118 C0173 C0189 C0190 C0211 C0212 C0213 C0215 C0221 C0543
- **option-gated (5):** C0099 C0125 C0141 C0380 C0549
- **pragma (4):** C0051 C0082 C0084 C0085
- **skip (2):** C0243 C0426

**Out of offline scope — ide-only (35):** C0053 C0078 C0102 C0103 C0104 C0106 C0164 C0165 C0180 C0188 C0191 C0209 C0225 C0269 C0298 C0319 C0344 C0357 C0398 C0406 C0415 C0456 C0513 C0514 C0515 C0516 C0517 C0541 C0554 C0555 C0561 C0569 C0571 C0579 C0584

## "Looks offline" is optimistic — the demotion risk

Some codes look like cheap clean-ast wins but are resolution-dependent in disguise and only reveal it against the
corpus. Treat any candidate that touches one of these as a **demotion risk** — build it, but expect the corpus gate
to move it to `resolution` (or an `optionGated` deferral):

- **enum members** — valid where a "constant" is expected (CASE labels, initializers) but resolve like a
  non-constant symbol → a naïve "is it constant?" test false-positives. (Demoted C0218; same shape as C0062.)
- **symbol constancy** — `VAR CONSTANT` / library / global constants aren't uniformly flagged constant in the
  symbol model, so "folds to a constant?" is not "is a constant".
- **statement-list / aggregate semantics** — fall-through empty CASE arms (demoted C0426), aggregate-init
  element structure (opaque `tokens`, no parsed element list) — the AST doesn't carry what the check needs.

The discipline that makes this safe: build the cluster, let the corpus gate demote the fragile members, ship the
solid subset, and record *why* in the deferred code's `note`.

## Two load-bearing findings from the empirical pass

1. **Almost nothing is already-matching.** Running every `checkable` repro through the current engine, only **C0049**
   matched exactly and **C0046** matched its primary message. The catalog's old `ourCheck` annotations
   (`unknown-member`, `call-arguments`, …) were **aspirational** — those checks fire, but with *our* wording, which
   differs from the harvested docs (e.g. C0004: ours `'zzz' is no component of 'MyS'` vs docs
   `Type 'unknown type: …`). So "flip an existing check" is rarely free; it means reconciling the catalog `expect`
   to our real output and accepting **provisional** wording until a live recording settles it.
2. **The docs `expect` is unreliable** — corrupted placeholders (`'Variable'`, `'%??'`, `'!!!ERROR!!!'`),
   inconsistent repro/expect (C0003 declared `BOOL` but expected `for 'w'`), and fits-a-wider-type traps
   (C0001 `999`, C0062 `int.name` = symbolic bit access). **Every catalog flip must sanity-check the repro** and
   pass the corpus zero-FP gate before trusting it.

## Where the frontier is now (2026-07-10)

The clean, zero-FP-by-construction wins are **banked** — clean-ast clusters (const-eval, CASE labels, aggregate-init,
conversions, operator/pointer operands), the declaration/header-shape family (C0096/C0144/C0145/C0149/C0182/C0421/
C0542), lifecycle + method-signature, and the intrinsic-operand set (C0022/C0023/C0234/C0235/C0240/C0241). **109
implemented.** The 76-code offline backlog above is deliberately *not* on the autonomous loop, because each remaining
bucket is a judgment call, not a presence test:

1. **resolution (35)** — the only bucket with real "get-closer-to-IDE" headroom, but every family (callee-signature
   overloads, inheritance/interface chains, globals/externals, generics, dataflow) needs a resolver **and** carries a
   false-positive surface (library types, unseen bases, compiler options). Build a family only when it's justified,
   and settle the zero-FP slice with a human — the corpus + conformance gates are the arbiters. C0062 is the canonical
   example (member-on-non-struct: must resolve the base as elementary AND exclude integer bit-access + bit-alias
   constants).
2. **parser (30)** — the syntax layer already emits a recovery diagnostic at these spots; reproducing CODESYS's exact
   wording needs statement-body/declaration parsing, which inverts the single-source design for marginal value. Do NOT
   hand-roll them as semantic checks.
3. **option-gated (5) · pragma (4) · skip (2)** — corpus-demoted (an unseen compiler option flips them → FP), pragma-
   operand validation (FP-prone vs library pragmas), or no ground truth. Left as-is with a per-code `note`.
4. **ide-only (35)** — out of offline scope by design; the IDE build stays authoritative. `test.skip` in the burn-in.

**Before any implemented code is "done":** one live record sweep to flip `verified` and settle every provisional
wording (incl. the C0064 `Dereference`/`Dereferencing` drift). Until then, offline-green = "done pending recording".
