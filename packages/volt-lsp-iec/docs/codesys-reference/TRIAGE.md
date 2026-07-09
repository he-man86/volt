# CODESYS error-catalog triage

Which of the 220 documented `Cnnnn` codes the LSP can check **offline** (its whole job), and what each still needs.
This is the map that keeps catalog work batched-by-tier instead of code-by-code (see `error-catalog.json`,
`src/reference/error-codes.ts`, and the burn-in `error-catalog.test.ts`).

Regenerate the tier split, the "already matches" scan, and corpus false-positives with:

```
bun scripts/corpus-fp.ts        # tally error-severity FPs by check code across the corpus (the zero-FP oracle)
```

## The tiers

| Tier | Meaning | What it needs beyond today | Count |
|------|---------|----------------------------|------:|
| **implemented** | a check emits it, burn-in green | — | 10 |
| **A · clean-ast** | AST node shape + local type inference + const-eval | nothing new — next cheap wins | 71 |
| **B · resolution-dependent** | needs cross-symbol resolution (callee signature, base class, interface, global, labels, access modifiers, generics, call graph) | a resolution helper per family | 83 |
| **C · parse / decl-structure** | a syntax/token/declaration-shape error | belongs in the **syntax layer's** error reporting, not semantic checks — a separate track | 34 |
| **D · ide-only** | build/memory/device/codegen/cross-library/online | impossible offline; wording is **record-only** | 22 |

## A-tier is optimistic — the demotion risk

Some codes classified **A · clean-ast** are resolution-dependent in disguise and only reveal it against the
corpus. Treat any A-code that touches one of these as a **demotion risk** — build it, but expect the corpus gate
to move it to B:

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

## Implemented (10)

`C0001 C0003 C0032 C0046 C0047 C0049 C0064 C0066 C0074 C0077`

## A · clean-ast — the cheap backlog (71)

Doable with today's infra (`forEachExpr`, `inferExprType`, `constEval`, elementary facts, `resolveTypeExpr`).
Group by the sub-machinery they reuse:

- **const-eval on literals/bounds:** C0161 C0162 C0216 C0217 C0219 C0227 C0266 C0526 C0549 C0198(string len) C0555(encoding)
- **CASE labels:** C0216 C0217 C0218 C0219 C0426
- **aggregate-init shape** (sibling of C0074): C0075 C0076 C0232 C0233
- **conversions** (extend narrowing/sign-change/compare): C0033 C0068 C0069 C0195 C0196 C0197 C0208 C0354
- **operator/pointer operands:** C0050 C0061 C0070 C0126 C0131 C0242 C0355 C0380 C0454
- **declaration-shape / attributes:** C0018 C0042 C0045 C0096 C0122 C0124 C0125 C0139 C0140 C0141 C0182 C0183 C0185 C0203 C0204 C0205 C0206 C0222 C0228 C0238 C0240 C0241 C0344 C0351 C0373 C0421 C0441 C0509 C0525 C0533 C0550 C0584 C0098 C0099 C0191

## B · resolution-dependent (83)

Each family unlocks together once its resolver exists. **Build the resolver only when the family is big enough**
(triage-first, then decide):

- **callee signature** (biggest — extends `call-arguments`): C0022 C0023 C0035 C0036 C0037 C0038 C0039 C0040 C0041 C0043 C0044 C0080 C0130 C0138 C0177 C0201 C0224 C0357 C0554 C0561 C0581
- **member/global/constant resolution** (unblocks C0062): C0004 C0046-adj C0065 C0136 C0207 C0230 C0508 C0564
- **inheritance / interface / access modifiers:** C0086 C0087 C0089 C0090 C0091 C0094 C0097 C0101 C0143 C0144 C0145 C0178 C0179 C0199 C0225 C0230 C0239 C0316 C0371 C0406 C0511 C0513 C0514 C0515 C0516 C0517 C0540 C0542 C0567 C0568 C0571 C0576
- **labels (JMP):** C0114 C0115 C0116 C0117 C0118
- **lifecycle sigs** (extend `lifecycle`): C0119 C0120 C0565 C0566
- **generics:** C0585 C0586 C0587 · **overloads:** C0582 C0583 · **misc:** C0062 C0072 C0186 C0234 C0235 C0236 C0237 C0243 C0269

## C · parse / decl-structure (34)

`C0002 C0005 C0006 C0007 C0008 C0009 C0010 C0011 C0013 C0015 C0020 C0026 C0027 C0030 C0031 C0051 C0081 C0082 C0084 C0085 C0149 C0168 C0169 C0173 C0174 C0175 C0189 C0190 C0211 C0212 C0213 C0215 C0221 C0543`

These are the parser/lexer's domain (token-expected, missing keyword/semicolon, malformed decl, misplaced VAR block,
pragma syntax). The semantic-check layer is the wrong home. **Decide first:** does the ST parser already surface these
as parse errors (then just map them), or is this a separate reporting track? Do NOT hand-roll them as semantic checks.

## D · ide-only — record-only (22)

`C0053 C0078 C0102 C0103 C0104 C0106 C0164 C0165 C0180 C0187 C0188 C0209 C0298 C0319 C0398 C0415 C0456 C0541 C0569 C0572 C0573 C0579`

Build/memory/device/codegen/cross-library/online-change. No offline check is possible with zero FPs; only their
**wording** gets locked at the live record pass. Keep them `checkable`/`ide-only`, never `implemented` via an offline check.

## Recommended order

1. **Clean-ast, machinery-clustered.** Do A in reuse-clusters (all CASE-label codes, all aggregate-init codes, all
   conversion codes) so one piece of shared logic lands several codes. Each still gets a colocated test + corpus gate.
2. **Then the callee-signature resolver** (tier B's biggest family, ~20 codes) — one resolver, many flips.
3. **Parse tier as a separate investigation** — first answer "does the parser already emit these?".
4. **One live record sweep** to flip `verified` and settle every provisional wording (incl. the C0064
   `Dereference`/`Dereferencing` drift). Until then, offline-green = "done pending recording".
