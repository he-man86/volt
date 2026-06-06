# 15 — LD Elements

> **Source (landing page):** https://content.helpme-codesys.com/en/CODESYS%20LD%20FBD/_cds_fbd_il_ld_f_elements.html
> **Retrieved:** 2026-06-01
> **CODESYS publication:** "CODESYS LD FBD"

## Summary

This file catalogs the **LD-specific** editor elements — `Contact`, `Coil`, `Branch Start/End`, and `Closed Branch`. Elements shared with FBD (Network, Box, Box with EN/ENO, Assignment, Jump, Return, Branch, Execute) are documented in [14-fbd-elements.md](./14-fbd-elements.md); LD bodies use those too.

LD-exclusive page chain reachable from the elements landing → "Next" series:

1. LD Element: Contact → `_cds_ld_element_contact.html`
2. LD Element: Coil → `_cds_ld_element_coil.html`
3. LD Element: Branch Start/End → `_cds_ld_element_branch_start_end.html`
4. LD Element: Closed Branch → `_cds_ld_element_closed_branch.html`

As with FBD, the docs are terse. PLCopenXML element names below are derived from the IEC 61131-10 schema and the [fbd-authoring](../../../.claude/skills/fbd-authoring) skill, not from the CODESYS docs themselves.

## The power-rail model (background)

The CODESYS LD docs never explicitly describe the **left/right power rail** model, but every LD network in PLCopenXML implicitly has:

- **`<leftPowerRail>`** — the implicit source of `TRUE` on the left edge of every rung
- **`<rightPowerRail>`** — the implicit sink on the right edge of every rung

Contacts, coils, and branches all wire `localId`s into these two rails. Multiple rungs in a network share the same pair of rails; parallel coils are stacked vertically and all connect to the right rail. This is what makes the rung representation "look like" relay-ladder wiring.

The CODESYS UI hides the rails; they're rendered as the left and right vertical lines of the diagram. The bridge round-trips them as proper PLCopenXML elements.

## Element catalog

### Contact

> **Page:** `_cds_ld_element_contact.html`
> **PLCopenXML:** `<contact>` with attributes `negated`, `edge` (`rising` or `falling`), and `storage`. The contact's `<variable>` child names the boolean operand; `<connectionPointIn>` and `<connectionPointOut>` wire it into the rung.

**Available only in the LD editor.**

"A contact passes on the signal `TRUE` (ON) or `FALSE` (OFF) from left to right until the signal finally reaches a coil in the right side of the network." Assign a Boolean variable by replacing the `???` placeholder above the contact graphic.

#### Series and parallel

- **Parallel contacts** → behave as `OR`: only one contact needs to be `TRUE` for the signal to pass.
- **Series contacts** → behave as `AND`: all contacts must be `TRUE` for the signal to pass.

Mirrors classical electrical-relay logic.

#### Negated contact

A negated contact passes `TRUE` when the variable is **`FALSE`**.

- Insert via the **FBD/LD/IL → Negation** command (`Ctrl+N`), or
- Insert a negated contact directly from the Tools view.

PLCopenXML: `<contact negated="true">`.

#### Rising-edge / falling-edge contacts

Documented under the **Edge Detection** command (`Ctrl+E`): "The command inserts an edge detection before the selected box input or box output." The same command applies to contacts.

- **Rising-edge contact** → passes `TRUE` for one cycle when the variable transitions from `FALSE` → `TRUE`. PLCopenXML: `<contact edge="rising">`.
- **Falling-edge contact** → passes `TRUE` for one cycle when the variable transitions from `TRUE` → `FALSE`. PLCopenXML: `<contact edge="falling">`.

Equivalent in ST to `R_TRIG` / `F_TRIG` instances.

#### Convert to coil

When hovering over a contact in a selected network with the mouse button pressed, a **"Convert to coil"** button appears, allowing in-place conversion.

**Related command:** Insert Contact (`Ctrl+K`) — "inserts a contact to the left of the selected element."

**Gotchas:**
- A contact's variable must be `BOOL`. Other boolean-like types (`BIT`, bit-access expressions) need explicit conversion.
- Edge-detect contacts implicitly create a hidden `R_TRIG`/`F_TRIG` instance per occurrence — they have **state**, and CODESYS allocates it in the containing POU's instance image. Two edge contacts on the same variable do **not** share state.

### Coil

> **Page:** `_cds_ld_element_coil.html`
> **PLCopenXML:** `<coil>` with attributes `negated`, `storage` (`set` or `reset`), and `edge`. `<variable>` names the boolean operand; `<connectionPointIn>` wires the rung's accumulated boolean value into it.

**Available only in the LD editor.**

"A coil applies the value supplied from the left and saves it in the Boolean variable assigned to the coil." Multiple coils in a network must be arranged **in parallel only** — never in series.

#### Negated coil

`<coil negated="true">` — stores the **inverted** value of the incoming signal in the assigned boolean variable.

Insert via **FBD/LD/IL → Negation** (`Ctrl+N`) applied to a coil.

#### Set coil

`<coil storage="set">` — "When the value `TRUE` arrives at a set coil, the coil retains the value `TRUE`."

The set coil **does not auto-reset**; once set, the variable stays `TRUE` until something else (a Reset coil, ST assignment, etc.) writes `FALSE` to it.

**Command:** Insert Set Coil.

#### Reset coil

`<coil storage="reset">` — "When the value `TRUE` arrives at a reset coil, the coil retains the value `FALSE`."

Symmetric to Set: holds the variable at `FALSE` once triggered, no auto-revert.

**Command:** Insert Reset Coil.

#### Set/Reset toggle command

The **Set/Reset** command (`Ctrl+M`) cycles a selected coil through three states: **reset → set → none**. Requires the FBD/LD/IL editor active and an element with a boolean output selected.

#### Rising-edge / falling-edge coils

The Edge Detection command also applies to coil outputs — equivalent to wrapping the assignment in a one-cycle pulse.

- PLCopenXML: `<coil edge="rising">` or `<coil edge="falling">`.

**Related commands:** Insert Coil (`Ctrl+A`), Insert Set Coil, Insert Reset Coil, Set/Reset.

**Gotchas:**
- A network with both a Set coil and a Reset coil on the same variable will exhibit **last-write-wins** semantics within that scan cycle — the order is determined by `executionOrderId` of the coils, not by their visual position alone.
- Stacked parallel coils write **independently** to their variables — they're not OR'd together. A `FALSE` rung leaves a Set coil's variable at its previous value (the set is sticky); a normal coil writes `FALSE`.
- The docs do not document a "retentive" coil variant separately from Set/Reset — retention is a property of the variable declaration (`VAR RETAIN`), not the coil.

### Branch Start/End

> **Page:** `_cds_ld_element_branch_start_end.html`
> **PLCopenXML:** No dedicated element — branch start/end markers exist only as graphical anchors in CODESYS-XML and are reconstructed from connection topology in PLCopenXML round-trip.

A purely structural element: "The element is used for the Closed Branch."

The CODESYS docs treat Branch Start/End as a UI helper for *building* a Closed Branch — the user marks where a parallel sub-rung begins and ends. The actual semantic content lives in the resulting Closed Branch (next section).

**Gotcha:** This element does not exist as a standalone construct in PLCopenXML; only the resulting parallel topology (multiple paths between the same two connection points) survives serialization.

### Closed Branch

> **Page:** `_cds_ld_element_closed_branch.html`
> **PLCopenXML:** Represented by parallel `<connection>` paths between a shared input connection point and a shared output connection point. The parallel paths share `localId`s on the start/end side and contain their own contact/box elements.

A **closed branch** is "a feature of the LD language. It has a start point and end point and enables parallel analyses of logical elements." There are two distinct semantic uses:

#### Closed branch at a contact (OR)

When you select a box or contacts and run **Insert Contact Parallel**, "a parallel branch is inserted with a single vertical line." Signal flow passes through both branches → **OR** evaluation:

```
   +---[A]---+
---|         |---
   +---[B]---+
```

`OUT := A OR B`.

**Commands:** Insert Contact Parallel (above), Insert Contact Parallel (below).

#### Closed branch at a box (short-circuit evaluation / SCE)

When you select a **box** and run Insert Contact Parallel with the parallel path containing additional logic, "short-circuit evaluation (SCE) is implemented." This allows **bypassing function block execution** when a specific condition is TRUE.

**Behavior (verbatim from the docs):**
- Branches **without function blocks** are processed first.
- If `TRUE` is detected in those branches, "the function block is not called in the parallel branch" — the input passes directly to the output (the box is skipped).
- If `FALSE`, the box executes normally.
- All branches containing function blocks have their outputs logically OR'd.

**Visual marker:** "Double vertical connections signify SCE constructs, while single vertical connections indicate OR constructs."

**Example ST equivalent given by the docs:**

```st
P_IN := b1 AND b2;
IF ((P_IN AND cond1) AND (cond2 OR cond3)) THEN
   P_OUT := P_IN;
ELSE
   x1(IN := P_IN, PT := {p 10}t#2s);
   tElapsed := x1.ET;
   P_OUT := x1.Q;
END_IF
bRes := P_OUT AND b3;
```

#### Inserting / managing closed branches

The docs list these four commands for building closed branches:
- Insert Contact Parallel (below)
- Insert Contact Parallel (above)
- Set Branch Start Point
- Set Branch End Point

A `Toggle Parallel Mode` command also exists for switching the rendering/semantics between OR and SCE on the same topology.

**Gotchas:**
- **OR vs SCE is determined by the vertical line style** (single vs double), which is rendered metadata. The PLCopenXML round-trip must preserve this distinction or the semantics flip silently. Currently the bridge treats this as opaque.
- SCE means the function block in the bypassed branch **does not advance its internal state** that scan — important for timers and edge detectors. AI-generated code must respect this.
- Inside an SCE branch, the bypass branch may itself contain side effects via Execute or assignments — those side effects also are skipped on bypass.

## Networks composed of multiple rungs

The CODESYS docs treat each "network" as a single rung in LD, but in practice an LD network can contain multiple stacked rungs sharing the left/right power rails. PLCopenXML serializes them as multiple parallel paths from `<leftPowerRail>` to `<rightPowerRail>` within one body. The bridge currently treats the network → rung relationship as 1:1; multi-rung networks are flattened on import.

## What the docs do NOT cover

- **PLCopenXML mapping.** Same gap as in [14-fbd-elements.md](./14-fbd-elements.md) — no schema cross-reference in the CODESYS pages.
- **Edge-detect implementation.** The docs say the Edge Detection command inserts an edge before a contact/coil/pin, but do not specify where the implicit `R_TRIG`/`F_TRIG` state is allocated or how it's named in the symbol table.
- **Coil retention.** No dedicated "retentive coil" variant page — retention is achieved via variable declaration (`VAR RETAIN`), not coil attribute.
- **Multi-rung network layout rules.** Whether multiple coils in the right column must always be vertically stacked, and how the LSP should diagnose horizontally-adjacent coils (which are syntactically illegal).
- **LD-to-FBD interop.** A box element inside an LD network behaves identically to one in an FBD network — but the docs never explicitly say so, and pin-typing rules at the rung-to-box boundary are unstated. (In practice, the box's first BOOL input is implicitly wired to the rung accumulator if there's no explicit input wire.)
- **EN/ENO inside an LD rung.** Whether the rung's accumulated boolean automatically wires to a box's `EN` pin is not spelled out, though that is the conventional behavior.
- **Comment / label inside a rung.** Documented only at the network level, not rung level.

These gaps must be filled by the conformance corpus (P4: `ld-element-tests.ts` ~20 tests) and bridge ground truth (P5).

## Notes for tooling

**LSP diagnostic candidates:**
- Series coils → error ("Coils must be in parallel only" — from the docs verbatim)
- Coil variable type ≠ `BOOL` → error
- Set coil and Reset coil on the same variable in the same network with ambiguous execution order → warning
- Edge-detect contact on a non-BOOL variable → error
- Closed branch where vertical-line style cannot be inferred (corrupt XML round-trip) → warning
- Multi-rung network with a coil on a non-rightmost column → error
- SCE branch containing a contact/coil with side effects that the user may not realize are skipped → low-priority warning

**Hover augmentation:**
- Contact: show the variable's type, current edge mode, and a note if rising/falling edge state is implicit
- Coil: show storage mode (none / set / reset / negated), variable's `VAR_RETAIN` status, and warn if multiple coils target the same variable
- Closed branch: show OR vs SCE semantics with link to the page above
- Hovering over the left/right power rail: show "implicit `TRUE` source" / "rung sink" annotation

**Completion:**
- Inside an empty rung: offer Contact, Negated Contact, R-edge Contact, F-edge Contact, Coil, Set Coil, Reset Coil, Box, Closed Branch
- After a contact: offer "series next" (place to the right) and "parallel" (insert below) as code actions
- Inside a `???` placeholder: BOOL variables and bit-accessors only, ranked first

**Bridge round-trip concerns:**
- Vertical-line style (OR vs SCE on closed branches) **must** be preserved — the bridge currently treats it as opaque metadata in `addData`
- Branch Start/End markers are UI-only; do not emit them as PLCopenXML elements
- Power rails should always be emitted (one left + one right per LD body), even for trivial single-contact rungs

Stage 5 deep-dives this into `src/reference/ld-elements.ts` and pairs with the existing `_fbd/` semantic checks under `src/semantic/checks/`.
