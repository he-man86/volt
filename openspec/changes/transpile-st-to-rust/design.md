# Design — decisions

Decisions taken 2026-09-03/04 while building the skeleton. Each records the evidence, because several were
taken *against* a plausible alternative and the reason is not recoverable from the code.

## 1. Nothing lowers to a Rust reference

**Decision.** A POU is a flat frame of slots. A name is a slot index. Pointers, `REFERENCE TO` and
`VAR_IN_OUT` will become indices into that same frame. Nothing in the IR ever becomes a Rust `&`/`&mut`.

**Why.** ST has no ownership. It has one static memory image: instances are fixed allocations, `VAR_IN_OUT`
*is* a pointer, `POINTER TO`/`REFERENCE TO` are real aliases, GVLs are global mutable state. Mapping any of
that onto Rust references loses to the borrow checker the moment two aliases are live — not at some exotic
edge, but at the ordinary case of an FB holding a pointer to another FB while a method mutates both.

**Evidence it is necessary.** `ADR` is the most-called name in the corpus (333 sites), ahead of `MAX` (309)
and `SEL` (209), with `SIZEOF` (56) and `__ISVALIDREF` (48) behind it. Aliasing is not a tail case in PLC
code; it is the mainstream.

**Evidence it works.** The emitted crate compiles under `rustc --emit=metadata -D warnings`, which runs
borrowck. `&mut self` is the only borrow in the output. Verified by a test that is skipped where rustc is
absent, so `bun test` stays toolchain-free.

**Cost accepted.** Index arithmetic instead of zero-cost references, and bounds checks (elidable later, if
measured). Rejected alternative: `unsafe` raw pointers, which matches ST semantics exactly but gives up the
one property that makes generated code auditable.

## 2. The IR carries the semantics; a backend carries none

**Decision.** Implicit widening is an explicit `convert` node. CASE labels are resolved constant ranges.
FOR/WHILE/REPEAT lower to one `loop` shape. ELSIF is a nested `if`. Every node holds a resolved `Type` from
`types/`. **If a backend ever has to decide something, the lowering is incomplete — that is the bug.**

**Why.** 100% coverage means handling implicit conversion, aliasing, overloads, arrays, strings and every
place ST diverges from the target language. If a backend reads the AST it must re-derive types at every node,
and the rules scatter across string-building code. One IR is one home for semantics, and it is what lets the
interpreter and the emitter share them rather than drift.

**Enforced, not hoped.** `scripts/check-layering.ts`: inside `transpile/`, only `ir/` is importable across
folders. A backend cannot reach into `lower/`, and the backends cannot reach each other.

## 3. Codegen typing is a different question from inference typing

**Decision.** Lowering does not take operator types from `inferExprType`. It computes them from the operand
types over the widening lattice `types/elementary` already owns, and reports `type-unknown` if that fails.

**Why.** `inferExprType` answers the LSP's question — "what can I safely say this is?" — and returns
`UNKNOWN` wherever a guess would be a false positive. `REAL + INT` is one of those. A backend cannot emit
`UNKNOWN`. Both behaviours are right for their consumer; the mistake would be to change inference to suit
codegen and lose the zero-FP property that the diagnostics depend on.

**Not a duplicate.** The *facts* (family · bits · signed · rank) still come from `types/elementary`. Only the
question differs.

## 4. Literals type from context, sibling operand first

**Decision.** An IEC integer literal has no intrinsic type. It takes the sibling operand's type if there is a
typed one, then the assignment target's, then the narrowest type that holds the value.

**Why.** `rate := n / 2` with `n : INT` must divide in INT and convert the *result*. Propagating the
assignment target inward instead makes it 3.5 — a different program, silently. Found by a test, not by
reading.

**Unverified corner, marked in the code.** An all-constant expression (`x : REAL := 7 / 2`) takes the
context's type. Which vendors actually do there is not confirmed; every case with a variable operand is
decided by the rule above and is unaffected.

## 5. Coverage is counted over POUs *with a body*

**Decision.** `lower-completeness.ts` reports lowered/blocked against the 301 POUs that have statements, and
lists declaration-only POUs and METHOD/ACTION bodies separately.

**Why.** The first version of the script counted all 6,079 units and reported **91.4% lowered** while not one
real POU ran — because 5,778 units are empty-bodied, with their logic in separate METHOD/ACTION units. A
coverage number whose denominator flatters it is worse than none.

## 6. The standard blocks and functions are runtime, not language server

**Decision.** `TON`, `CTU`, `R_TRIG`, and the built-in functions belong in a Rust runtime crate beside the
IEC numeric semantics — written once, ground-truthed against the vendor. Not hardcoded in `volt-lsp-iec`.
The crate is created when something needs it, not as empty scaffolding.

**Why.** They are a library implementation, not language semantics — and the LSP's job for them is only to
know the names exist (`reference.ts` already does that). An earlier attempt implemented nine of them as
native TypeScript inside the LSP; it was removed.

**The failure it prevents.** That attempt's parameter names (`RESET1` for RS, `PT`/`ET` for TON) were written
from memory and checked by nothing. They would have run POUs wrongly while passing their own tests — exactly
the failure the backend's `Unsupported`-everything-unknown rule exists to avoid. Parameter names must come
from the bridge's library-signature extraction.

## 7. The oracle is differential execution, not recall

**Decision.** Before the built-ins are implemented, build a harness that runs a POU in a live headless IDE
and through the interpreter, and compares state.

**Why.** 81 built-ins plus conversion and rounding rules is far past the point where remembered vendor
behaviour is safe. Two vendor facts asserted from memory in one session were wrong (that `LIMIT` is usable as
a variable name; the standard blocks' parameter names). At this scale that is not an occasional slip, it is
the dominant cost — and it produces confidently wrong results, which is worse than gaps.

**It is cheap here.** The bridge already drives a headless CODESYS over a named pipe against a committed
fixture project (`scripts/codesys-pipe.ps1`). The missing piece is reading variable state across scan cycles,
not the harness itself.

## 8. What "fully implemented" means

| target | reachable |
|---|---|
| every language construct lowers and runs | yes |
| every **built-in** (2,424 corpus sites, 81 names) | yes — IEC-specified and bounded |
| every corpus POU executes correctly | yes, with 1–2 above |
| every real project runs | **no** — third-party libraries ship compiled, with no source to lower |

**Decision.** The goal is *language + built-ins + the standard library*, plus a way to **stub an external FB**
so a POU that calls one is still testable. Chasing literal 100% means reimplementing other vendors' libraries
indefinitely.

## 9. OPEN — the memory model, and it blocks phase 3

`Place` is `{ slot, path }` with `path` empty. Two ways forward:

| | slot + path | byte-addressed image |
|---|---|---|
| locals, fields, array elements | direct | direct |
| `ADR` of an arbitrary sub-location | needs an encoding | native |
| `VAR_IN_OUT` | index + path tuple | offset |
| emitted Rust | named struct fields — readable | one `[u8; N]` — opaque |
| debuggability of output | high | low |

**This must be settled before FB instances, methods and GVLs are built**, because those are what a pointer
points *at*. Building them on slot indices and then discovering `ADR` needs offsets means doing that work
twice. A hybrid is likely — named fields for the common case, with a lowering-computed offset for anything
`ADR` is taken of — but it is a decision, not a default, and it is not taken yet.
