# The pointer model — what is built, what the corpus needs, and the decisions that remain

**Supersedes nothing in `design.md` §9; it finishes it.** §9 chose a hybrid, handle-first model in three forms and
said "measure before building it". Only form 1 was built. This is the measurement, the two structural findings it
produced, and the decisions that were still open.

Written 2026-09-20. Evidence is a **parse-based** census of the five-project corpus with `Library Manager/`
excluded — §9's census was a text search, and two of its numbers are wrong (below).

---

## 1. Why this is the next decision

`pointer-order` is the second-largest blocker in the corpus: **177 POUs of 304 reach it, 5 are stopped by nothing
else**. Beside it sit `pointer-value` (81), `pointer-targets` (1) and `place-shape` (95, partly the same cause).
Every other blocker above it is out of scope by design (`place-not-local` is library namespaces) or settled
(`init-not-constant`, `conversion-type`, `fb-init-argument`).

More to the point: §9 says this must be settled **before** FB instances, methods and GVLs are built, because those
are what a pointer points at. Those are now built. So this is the last decision that can still be taken cheaply.

## 2. What is built today — form 1, and only form 1

`Lowering.shared.pointers` maps a `pointerKey` to one `PointerTarget`:

```ts
interface PointerTarget { base: Place; element?: { lower; length; type }; scopedTo?: Lowering }
```

One base place per pointer variable, recorded when an `ADR` is stored into it, consulted when it is dereferenced.
That is §9 form 1 exactly: *its target is static, so there is no pointer at all* — `p^` lowers to the target's own
place and the pointer variable disappears.

Everything else is refused, and the refusals are honest about it:

| refusal | means |
|---|---|
| `pointer-order` | a deref, or a copy, before any `ADR` was seen — 177 POUs |
| `pointer-value` | a pointer VALUE the model cannot name — 81 |
| `pointer-targets` | a second, different `ADR` into the same pointer — 1 |

`pointerKey` returns `undefined` for a field of another instance, an element, and a VAR_IN_OUT — so those are
refused before a target is even looked for.

## 3. The census

**192 pointer/reference declarations in project code.**

By where they live — which is what decides whether a value outlives a call:

| | count |
|---|---|
| FUNCTION / METHOD `VAR_INPUT` (incl. REFERENCE) | 63 |
| FUNCTION_BLOCK `VAR_INPUT` (incl. REFERENCE) | 36 |
| FUNCTION / METHOD locals (`VAR`, `VAR_INST`) | 59 |
| FUNCTION_BLOCK `VAR` (incl. REFERENCE) | 34 |

By how many targets are visible at the declaration:

| | count | form |
|---|---|---|
| exactly one | 79 | **1** — built |
| two | 13 | **3** — a handle |
| none visible | 100 | 96 of them are PARAMETERS; the target comes from the caller |

How they are used:

| deref `^` | `p[i]` | `p + n` | passed to a call | **tested against 0** | other compare |
|---|---|---|---|---|---|
| 391 | 12 | **88** | 404 | **16** (on 10 variables) | 1 |

**Two corrections to §9's census**, both from it having been a text search:

- **Pointer arithmetic is not "almost absent".** §9 records `(p + n)^` and `p := p + …` as **0 and 3**. It is
  **88**. Most of it is two FBs walking a byte's bits (`adr_bit0_Of_Byte + 1 … + 7`), so the *shape* is narrow —
  but "almost absent" is what justified leaving arithmetic out, and that justification does not hold as written.
- **Null tests exist.** 16 of them, on 10 variables. §9's form 1 requires a target "never tested for null", and
  nothing counted how often that disqualifies it.

## 4. Finding one: a parameter's form is decided by the CALLEE, not by the call sites

§9 classifies a pointer parameter by what the callers pass. That cannot be measured here and does not need to be:

- it is largely unmeasurable — **89 of 99 parameters have no call site this census can see**, because lenze-mid's
  callers are FBD/LD bodies, which reach the backend through network text rather than through a parsed body;
- it is the wrong question. A parameter is a borrow **for the duration of the call**. Whether that is sound depends
  on whether the callee *keeps* the pointer past the call — a property of the callee's own body.

Measured that way, over the same 99 parameters:

| | count |
|---|---|
| used only in the callee's own body → **borrow** | **62** |
| assigned into a name that outlives the call → **handle** | **≤ 30** |
| also read by a member unit of the same FB | 7 |

The 30 is an **upper bound**, and deliberately so: the test is "assigned into a persistent name", which catches
`start1 := adr_bit0_Of_Byte + 1` where `start1` is an FB field used immediately and never across calls. A liveness
test would move some of those to borrow. The bound is what matters for sequencing — even at its worst, borrow is
twice the size of handle.

## 5. Finding two: both missing forms already exist in the IR, under other names

This is what makes the work small, and it is the reason to take the decision now rather than design a new mechanism.

**Form 2 is `VAR_IN_OUT`.** The IR already carries `IrBinding = Place | IrCopy`, bound per call, for in-out
parameters — the callee addresses it as `root: "inout"` and the caller supplies a place. A `POINTER TO T` input the
callee only dereferences *is* an in-out binding with a `^` on every use. Nothing new is needed in the IR or in
either backend: the emitter already prints in-outs as `&mut`.

**Form 3 is the interface mechanism.** An interface variable holds a **tag**; `IrDispatch` carries `arms`, each a
tag and the call to make for it; `shared.interfaces` tracks which tags a variable may hold, including a `foreign`
flag for a value that arrived from outside. A stored pointer is the same shape with a **place** where the call is:
hold a tag, and a deref selects the arm. The tracking, the arms and the "may hold nothing" case are all built.

So the model is not three mechanisms. It is **one mechanism (the tagged handle) plus two erasures** — form 1 erases
the pointer when there is one target, form 2 erases it into an existing binding when it never outlives the call.

## 6. What the five sole-blocked POUs actually need

They are not one class, and only one of the two classes is a memory-model problem:

| POU | needs |
|---|---|
| `MapperBase`, `MapperOutputs` | **form 3.** A `REFERENCE TO` FB field, bound by a METHOD (`THIS^.sliceInfo REF= sliceInfo`), `__ISVALIDREF`-tested, then dereferenced. The archetype. |
| `EjectorCorePullerFB` | the same, inherited — its own body is `SUPER^()`. |
| `Bools_To_Byte`, `Byte_To_Bools` | **not a memory-model problem.** Their `POINTER TO BOOL` input is filled by nobody: the only declaration of one in the corpus is never called (`test_IW132` in `General.prg`, declared and never called). Lowering them as a ROOT asks what a root does with an unsupplied pointer input — the same question `fb-init-argument` raises about an unsupplied `FB_Init` argument, and the same answer: the vendor does not run this either. |

**So form 3 is worth three of the five, and the other two are a harness question.** That is a smaller prize than
`sole: 5` suggests, and saying so is the point of measuring.

> **BUILT AND MEASURED, 2026-09-20 — and the shape is more common than this section predicted.** `pointer-root-input`
> (D5) now separates the harness case from the model case, and the work list says `pointer-order` **sole: 3**, exactly
> as predicted. But the new code reaches **SEVEN** POUs, not two: the two named here plus five more of the same shape.
> The prediction was right about the prize and wrong about the size of the class.
>
> One claim did not survive into the message. This section says "the vendor does not run this either", which was
> checked for these two and not for the other five, so the refusal states only what is true of all seven — lowered as
> the ROOT, the input has no caller. The dead-code fact stays here, where it is scoped to the POUs it was checked on.
>
> The implementation also corrected a wrong assumption of its own: `Lowering.isRoot` is NOT how you tell. It is set on
> the harness lowering `lowerUnit` builds, and for a FUNCTION_BLOCK that lowering only holds a frame that CALLS the
> FB — the body runs in a nested lowering where `isRoot` is false, so a guard on it fired on nothing. `Shared.root`
> names the POU the harness asked for, and that is the test. `routineMode` is excluded: a METHOD's `VAR_INPUT` IS
> supplied, by whoever calls the method.

## 7. Decisions

**D1 — the handle is a tag, and it reuses the interface machinery.** A stored pointer or reference lowers to a
tag-valued slot; each `ADR`/`REF=` into it registers an arm `{ tag, place }`; a deref lowers to a select over the
arms. Rejected: a fat pointer (root + path + index) as the uniform representation — it would replace the two
erasures that already work, make every emitted `p^` a match where today most are a field access, and cost the
readable Rust that §1 and §23 exist to protect.

**D2 — a parameter is a binding, not a handle, unless the callee keeps it.** "Keeps it" means: assigned into a
place that outlives the call, or read by a unit that can run outside it. Both are decidable from the callee's body
alone, which is already lowered before its callers.

**D3 — null is a tag, so any pointer tested against 0 or `__ISVALIDREF` is at least form 3.** Form 1 erases the
pointer, and an erased pointer has no null to test; today that is silently unreachable because the test is refused
earlier. The handle gets a reserved tag 0 meaning "none", which is what `IrDispatch` already does for an interface
holding nothing — it throws, and the recorder has seen a null write stop the application.

**D4 — pointer arithmetic stays refused, and the refusal moves.** `p + k` over an array element type is form 1's
existing `element` step and keeps working. Arithmetic that walks a region **not declared as an array** — the 88,
almost all of it two dead FBs stepping through a byte's bits — needs the byte view, which is §9's stated edge. It
stays `pointer-step`, but the message should name the byte view rather than "not whole elements", because that is
the work it is waiting on.

**D5 — a ROOT with an unsupplied pointer input is refused, and says why.** Same as `fb-init-argument`: a root has
no caller, and CODESYS does not run these either. Not a gap; a harness limit that should say so in its message.

## 7b. What the histogram found, which §8 did not plan for

**Measured 2026-09-20.** `pointer-order`'s message named no variable, so its 177 POUs were one undifferentiated
pile and `--why` could not tell the forms apart. Naming the pointer and its section turned it into a histogram:

| shape | POU-hits | the form it needs |
|---|---|---|
| a pointer **field** | 263 | 3 — the handle |
| a pointer **variable** | 232 | 1 or 3 |
| a pointer **input** | 91 | **2 — §8 step 1** |
| a routine local | 46 | — |
| an in-out | 8 | — |

Two things follow. **§8 ordered by cost, not by prize** — step 1 (form 2) is the third-largest class, and the
histogram says so; that is a fair trade for "needs no new IR", but it should be stated rather than implied.

And the largest single line — 141 POUs, all reaching `ONTIME.fb`'s `refSeconds` — **was not a memory-model
problem at all.** It is `refSeconds : REFERENCE TO UDINT REF= udiSeconds`, a reference bound at its DECLARATION.
The parser wrote `c.eatPunct(":=") ?? c.eatPunct("REF=")`: it accepted either operator and recorded neither, so
every such declaration reached every consumer as an ordinary assignment. Lowering bound no target and refused
each read; form 1 already handles this exactly, and had simply never been given the target. Recording the
operator (`VarDecl.initOp`) took **`pointer-order` from 177 POUs to 105**, lowered POUs 55 → 56, and reached
routines 543 → 549 (14 → 20 from a POU that runs).

The same dropped operator was corrupting source. `print.ts` emitted `:=` for every declaration initializer, so
FORMATTING a file rewrote `r : REFERENCE TO T REF= x` into `r : REFERENCE TO T := x` — a bind silently turned
into a store through an unbound reference, in the one component whose contract is that it does not change
meaning. It was invisible while the AST dropped the operator: the corpus round-trip gate compared two ASTs that
had both forgotten it, and failed on three real files the moment `initOp` existed.

**Still unmeasured, and deliberately not guessed at:** every conformance fixture binds with a STATEMENT
(`ref_ REF= p;`). The DECLARATION form has no vendor recording. What is implemented composes two measured facts —
the statement bind, and initializers running once in declaration order before the first scan — rather than
inventing a third, and the src tests pin read, write, survival across scans and per-instance independence. It
wants its own fixture family before it is called measured.

## 7c. Re-measured after the `REF=` fix — and §8's step 3 is NOT the biggest item

**Measured 2026-09-20, after the declaration-`REF=` fix landed.** That fix alone took `pointer-order` from 177
POUs to 105 and collapsed the "pointer variable" column, so the histogram §7b used to order the work no longer
describes the corpus:

| shape | §7b (before) | now | the form it needs |
|---|---|---|---|
| a pointer **field** | 263 | **263** | — see below |
| a pointer **variable** | 232 | **90** | mostly RESOLVED by the `REF=` fix |
| a pointer **input** | 91 | 87 | 2 — §8 step 1 |
| a routine local | 46 | 46 | — |
| an in-out | 8 | 8 | — |

**The field column is now 53% of what is left, and 220 of its 263 are ONE shape in ONE POU.** `pro2193`'s
`Increment` is a PROGRAM whose METHODs take an `ANY_INT` and write through a UNION of pointers:

```
uInput.p1_Byte := input.pValue;            // store into one member
CASE input.diSize OF
  1: uInput.p1_Sint^ := uInput.p1_Sint^ + …  // read back through another
```

**It is not form 3, and it is not the union.** Both were checked by reproducing the shape in isolation: a union
of pointers already resolves to ONE key (`pointerKey`, measured by `state_any_int_pointer_increment`), and
storing into one member and dereferencing another lowers today. What refuses it is `pointer-outlives`:
`recordTarget` allows a pointer that holds an in-out-rooted address only when the body is an FB's OWN
(`frameContext` starts `FB:`) and is NOT a routine — and here the holder is a PROGRAM's field written from a
METHOD.

That refusal is honest rather than wrong: the field outlives the call that supplied the address, so the next call
rebinds and CODESYS would follow a stale one. The conformance fixture that measures this shape
(`state_any_int_pointer_increment`, `confirmed`) declares its union as a FUNCTION LOCAL, which has no such
lifetime — so what is measured is the easy half.

**So the next measurement is a lifetime question, not a mechanism.** Does a pointer field written from an ANY
input's `pValue` in a METHOD hold anything meaningful after that method returns? `scopedTo` already models
"exact on the run that stored it" for an FB body; extending it to a ROUTINE's run is the shape of the answer, and
the fixture above is one `VAR` away from asking it.

**What §8 should say instead.** Step 1 (form 2, the pointer input) is 87 POU-hits and needs no IR. Step 3 (form 3,
the tagged handle) is worth far less than §7b implied now that the variable column has collapsed — the genuinely
multi-target locals are a small part of the remaining 90. The 220-hit item is neither.

## 8. Order of work

Sized by what each step unblocks, smallest first — and the first two need no new IR:

1. **Form 2 for a pointer parameter the callee does not keep** (62 declarations). Lower the parameter as an in-out
   binding and every `p^` as the bound place. No IR change, no emitter change.
2. ~~**D5's message**, and `pointer-step`'s (D4). Minutes, and they stop two classes being mistaken for gaps.~~
   **DONE 2026-09-20.** D5 became its own code (`pointer-root-input`) rather than a reworded `pointer-order`, for the
   reason `fb-init-argument` has one: the coverage report counts blockers per POU, so leaving it under `pointer-order`
   files a harness limit under a real construct. D4 split the two stepped-pointer messages — `size === undefined` means
   there is no element to step at all, and saying "not whole elements of its array" about it names an array that does
   not exist. **D4's new message is currently unreachable from the corpus** (`pointer-step` blocks 0 POUs: every
   stepped use sits in a POU an earlier refusal already stops), so it is pinned by a src test rather than by the
   corpus — it starts mattering when steps 1 and 3 clear the blockers in front of it.
3. **Form 3, the tagged handle** (≤30 parameters + 13 multi-target locals). Reuses `shared.interfaces`' tracking
   shape; new IR is a select-over-arms for a PLACE, which is `IrDispatch` without the call.
4. **`__ISVALIDREF`** falls out of 3 — it is the tag compared to 0.
5. The byte view, only if something still needs it after 1–4.

## 9. Measure before building — what is still unmeasured

§9 listed five; three are now recorded (`mem_*`), two are not:

- **`p[i]` and `p + SIZEOF(T)` over an array of structs** — the element step at a non-trivial stride.
- **A pointer to an FB instance calling a method through `^`** — whether `pInst^.M()` dispatches on the declared
  type or the stored one.

And two this census adds:

- ~~**What `__ISVALIDREF` answers for a reference that was never bound**~~ — **MEASURED 2026-09-20**, and D3 was
  right: `refdecl_isvalidref` answers TRUE for a reference bound at its declaration and **FALSE** for one never
  bound.
- ~~**Whether a `REFERENCE TO` field bound by a METHOD survives to the next scan**~~ — **MEASURED 2026-09-20**: it
  does. `refdecl_rebound_in_method` rebinds from a METHOD on the first scan and reads the NEW target's value (20)
  on the third. The assumption form 3 rests on is now a recording rather than a reading of `MapperBase`.

Both fell out of `declarations/reference-binding.ts`, which was written for the declaration-bind question and
answered these on the way. **Step 3 is no longer blocked on §9.** What it still needs is the two element-step
measurements above.

None of 1–2 in §8 depends on these. **Step 3 no longer waits on the two struck out above** — both are measured.
What it still wants is the two element-step measurements at the top of this section, which are about `p[i]` and a
non-trivial stride rather than about references; form 3 can start, and should record those before the element
step is built on top of it.

## What the pointer census got wrong about REACH — measured 2026-09-24

§8 orders the work "sized by what each step unblocks, smallest first" and puts **form 2 first (62 declarations)**.
Form 2 is now built for a routine's parameter, and its four acceptance tests match CODESYS. **The corpus did not
move**: still 56 POUs lowered, `pointer-order` still stopping 109. The ordering is wrong, and here is why.

### An FB's indirect VAR_INPUT is a FIELD, and it PERSISTS

`ptrparam_input_persists` supplies a `POINTER TO INT` input on one call and omits it on the next. The body still
reads **55** through it. So the address outlives the call by construction — which is §4's own test for a HANDLE
(`assigned into a name that outlives the call`), whatever the body does with it. Form 2 cannot erase it into a
borrow unless EVERY call site supplies it, and §4 established that call sites are largely unmeasurable here
(89 of 99 parameters have none this census can see). **Form 2 reaches a call frame only.**

### And every REACHED blocker is a field, not a frame

Declarations across the corpus, by where the parameter lives:

| | count | |
|---|---:|---|
| `POINTER` in a METHOD / FUNCTION | 14,466 | a call frame — form 2 reaches it |
| `REFERENCE` in a METHOD / FUNCTION | 2,020 | the same, once `REF=` is bound |
| `POINTER` / `REFERENCE` in a FUNCTION_BLOCK | 753 | a FIELD that persists — form 3 |

The 16,486 frame parameters look decisive and are not: almost all of them are in **declaration-only library
units**, which execute nothing. What `--why pointer-order` actually names, in POUs that RUN, is the other column:

```
 55 x4  uInput.p1_Sint …     a pointer FIELD of a union        form 3
 38      a local pointer      several stores                    form 3
 20      Drive                a field                           form 3
 18 x2  refVacuumHighTime, refReleaseVacuumTime                 form 3
          — `REFERENCE TO REAL` VAR_INPUTs of `VacuumFB`, commented "Optional", so a caller may omit them
  9,8,8  psValue, psProperties, psKey                           form 3
```

`refVacuumHighTime` is the shape in miniature: an FB input, a REFERENCE rather than a pointer, optional, and
therefore read behind an `__ISVALIDREF`. "May hold nothing" is precisely what the tag models, and §8 step 4 already
says `__ISVALIDREF` falls out of form 3 as the tag compared to 0.

### So the order is form 3, and form 2 was not wasted

Form 3 is the one mechanism; §5 says forms 1 and 2 are erasures of it, and §9 records that step 3 is no longer
blocked on any measurement. Form 2 stays because it is correct and it is what a routine parameter should lower to —
it simply does not unblock a corpus POU, and this file should not have implied it would.

- [ ] **Form 3, the tagged handle** — `shared.interfaces`' tracking shape, with a PLACE where `IrDispatch` has a
      call. Its acceptance tests are already recorded and sitting at `not-lowered`: `ptrparam_kept` (a stored input
      read a scan later), `ptrparam_input_persists` (supplied once, omitted after), `ptrparam_function_block`,
      `ptrparam_unsupplied` (nothing supplied, and the vendor FAULTS — the "holds nothing" arm), plus
      `refdecl_rebound_by_statement` and `refdecl_rebound_in_method` from `reference-binding.ts`.
- [ ] **`__ISVALIDREF`** — the tag compared to 0, and what `refVacuumHighTime`'s 18 POUs are gated behind.
- [ ] The reborrow (`ptrparam_passed_on`): a borrow handed to a second callee. Small, and form 2's own leftover.

## Form 3's foreign half — what it needs, measured 2026-09-24

The tagged handle now works for a pointer whose targets are recorded in the body that reads it: reads select
(`IrSelect`), writes switch, and six fixtures match CODESYS. What is NOT built is the case the corpus actually
has — an FB's pointer or reference INPUT, where the address comes from a caller.

**It is not form 2.** `ptrparam_input_persists` supplies the input on one call and omits it on the next; the body
still reads 55 through it. An FB VAR_INPUT is a field, so the address outlives the call by construction.

**And it is not form 3 as built either**, for a reason worth stating precisely: the arms would name variables of
the CALLER's frame, and the callee's body is lowered ONCE per FB type. `pointerKey` cannot even name the field
from the caller (`interfaceKey` shows the shape that can — `FB:<Type>.<Field>`), and naming it would not be
enough: the callee has to REACH what the tag names.

So the foreign half is the `lent` mechanism, applied to a variable instead of an instance:

- a registry of TARGETS with the frame each belongs to — `shared.instances`' twin;
- `Lowering.lends`, today `{ tag; type: function_block }[]` and printed `__lent_N: &mut <FbType>`, widened to any
  type, so a plain variable can be lent;
- `lendPlace`'s walk, to give the callee the place as IT can reach it;
- the deferred fixed point (`finishInterfaces` / `lendToCallees`), because a store later in the source reaches a
  read earlier in it on the next scan, and because lending propagates up every call chain.

That is the interface module's size again (~475 lines), and it is what `pointer-order`'s **2 sole-blocked POUs**
need. The refusal says all of this now: `pointer-foreign`, split from `pointer-order`, whose message —
"dereferenced before any address was stored into it" — was false here, since the caller stores one.

Acceptance tests already recorded and waiting: `ptrparam_function_block`, `ptrparam_input_persists`,
`ptrparam_unsupplied` (nothing supplied, and the vendor FAULTS — the "holds nothing" arm), and `ptrparam_kept`,
which additionally needs a pointer COPIED out of the input into a field.
