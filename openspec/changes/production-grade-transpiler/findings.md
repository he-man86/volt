# The 43 confirmed findings

Produced by a 16-agent review of every file in `src/transpile` (8 reviewers, each finding then
adversarially verified by a second agent instructed to refute by default). 10 further findings were
REFUTED and are not listed; 1 is UNCERTAIN and needs a live measurement.

| # | sev | kind | site | claim |
|---|---|---|---|---|
| T01 | high | bug | `src/transpile/lower/calls.ts:876` | An ANY argument's place is bound as a hidden VAR_IN_OUT without any of bindInOut's guards |
| T02 | high | bug | `src/transpile/emit/rust/emit.ts:172` | A negative constant is printed unparenthesized, so `-1i32.max(x)` becomes `-(1i32.max(x))` |
| T03 | high | bug | `src/transpile/emit/rust/emit.ts:530` | The MOD expansion binds `a` and `d`, shadowing locals of those names |
| T04 | high | bug | `src/transpile/emit/rust/emit.ts:566` | The bit-assign expansion binds `v`, shadowing a local of that name used in the target's index |
| T05 | high | bug | `src/transpile/emit/rust/emit.ts:679` | `routineFnName` has no uniqueness pass, so two routines that snake alike collide |
| T06 | high | bug | `src/transpile/lower/statements.ts:209` | A FOR loop's limit is never converted to the counter's type, so the emitted Rust does not compile |
| T07 | high | bug | `src/transpile/lower/expressions.ts:184` | A duration CONSTANT times/divided by an integer variable is retyped to DINT before the duration rule runs |
| T08 | high | bug | `src/transpile/interp/values.ts:226` | coerce's STRING branch is a catch-all: it answers for BOOL and TIME targets by parsing digits |
| T09 | high | bug | `src/transpile/ir/ir.ts:234` | IrBuiltin says nothing about argument evaluation, and interp evaluates every arg while the Rust emitter evaluates only the chosen one for SEL and MUX |
| T10 | high | bug | `src/transpile/lower/pointers.ts:118` | Lowering throws (RangeError) when a pointer is stepped over an element whose byte size is 0 |
| T11 | high | bug | `src/transpile/lower/interfaces.ts:258` | An ANY VAR_INPUT called through an interface gets the argument's VALUE where the routine expects its SIZE |
| T12 | medium | gap | `src/transpile/lower/calls.ts:502` | A PROPERTY through a REFERENCE TO an FB is not resolved, and lands in the expr-member / place-shape buckets |
| T13 | medium | cleanup | `src/transpile/index.ts:18` | The documented refusal taxonomy names two constructs that are now lowered |
| T14 | medium | gap | `src/transpile/lower/lower.ts:84` | A PROGRAM whose only own member is a PROPERTY is not lowered as an instance, and the refusal is mis-bucketed |
| T15 | medium | gap | `src/transpile/lower/lower.ts:492` | lowerSource swallows parse errors in library and GVL files |
| T16 | medium | bug | `src/transpile/emit/rust/emit.ts:439` | REAL → integer saturates above i64 range where the interpreter wraps — the two backends disagree |
| T17 | medium | cleanup | `src/transpile/lower/statements.ts:184` | lowerFor's doc block states the opposite of the code and of the comment ten lines below it |
| T18 | medium | gap | `src/transpile/lower/constants.ts:191` | A date literal outside JS Date's range throws out of lowering instead of reporting |
| T19 | medium | bug | `src/transpile/interp/values.ts:254` | an array element of a type with a declared initial value starts at the type's zero, not that initial value |
| T20 | medium | gap | `src/transpile/interp/interp.ts:264` | a math domain error returns NaN and keeps running, where the same evidence made division by zero throw |
| T21 | medium | gap | `src/transpile/ir/ir.ts:68` | holdsCall does not count the `call` node, so the fb-init-program refusal misses an FB_Init that calls an FB instance |
| T22 | medium | gap | `src/transpile/lower/places.ts:126` | A REFERENCE is never dereferenced for a field or index step, and the refusal names the wrong construct |
| T23 | medium | gap | `src/transpile/lower/bytes.ts:65` | `pack_mode` is never read for a FUNCTION_BLOCK, so a packed FB silently gets the aligned size |
| T24 | medium | gap | `src/transpile/lower/interfaces.ts:136` | instanceRelative treats the root FB's own frame as multi-instance, so every root-as-instance POU refuses a foreign interface store |
| T25 | low | cleanup | `src/transpile/lower/calls.ts:697` | lowerInvoke's `call-nested` comment describes a refusal the code no longer makes |
| T26 | low | cleanup | `src/transpile/lower/calls.ts:305` | The positional-parameter order is derived twice, from the same AST, in two places that can drift |
| T27 | low | cleanup | `src/transpile/lower/lowering.ts:60` | Shared.addressed carries two stacked doc comments and the first one contradicts the field |
| T28 | low | cleanup | `src/transpile/lower/lower.ts:17` | The header's "one file per concern" map is missing four of the lower/ files, and lowering.ts keeps empty section markers |
| T29 | low | cleanup | `src/transpile/lower/lower.ts:490` | Every library file's manifest is parsed twice |
| T30 | low | gap | `src/transpile/lower/lower.ts:462` | rootInstance can return an empty body with no diagnostic, producing a POU that succeeds and does nothing |
| T31 | low | cleanup | `src/transpile/emit/rust/emit.ts:510` | The `builtin` case has no default and falls through into `case "unary"` |
| T32 | low | cleanup | `src/transpile/emit/rust/prelude.ts:33` | `impl Default for IecStr` is dead code |
| T33 | low | cleanup | `src/transpile/lower/constants.ts:130` | foldConstant ends in a no-op ternary |
| T34 | low | bug | `src/transpile/interp/interp.ts:271` | unary neg on a REAL is computed as 0 - x, so -0.0 comes out +0.0 and disagrees with the emitted Rust |
| T35 | low | cleanup | `src/transpile/interp/interp.ts:217` | the shift and rotate widths fall back to a silent 32 where lowering always types the node |
| T36 | low | cleanup | `src/transpile/interp/interp.ts:98` | writeBack carries two stacked doc comments, the first of which documents bind() |
| T37 | low | cleanup | `src/transpile/lower/storage.ts:168` | The direct-address rule is spelled twice — regex, shape check and overlap bookkeeping — and one doc block sits on the wrong function |
| T38 | low | cleanup | `src/transpile/lower/storage.ts:13` | storage.ts and bytes.ts state opposite things about VAR_TEMP, and the SIZEOF consequence is unmeasured |
| T39 | low | cleanup | `src/transpile/lower/lowering.ts:60` | `Shared.addressed` carries two doc comments and the first contradicts the field's shape |
| T40 | low | improvement | `src/transpile/lower/pointers.ts:58` | `ADR(u.member)` is refused with a message that says a write, when it is a read |
| T41 | low | cleanup | `src/transpile/lower/specialize.ts:115` | Two silent fallbacks in the specializer would each collapse distinct bindings onto one body |
| T42 | low | gap | `src/transpile/lower/specialize.ts:47` | inFramePlace rejects a THIS^-rooted in-out target although named() already handles one |
| T43 | low | gap | `src/transpile/lower/interfaces.ts:171` | onEachTag remembers a tag but not the foreign flag it was seen with, so a later foreign store cannot re-open it |
