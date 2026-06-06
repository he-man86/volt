# 14 — FBD Elements

> **Source (landing page):** https://content.helpme-codesys.com/en/CODESYS%20LD%20FBD/_cds_fbd_il_ld_f_elements.html
> **Retrieved:** 2026-06-01
> **CODESYS publication:** "CODESYS LD FBD"

## Summary

CODESYS uses a **single shared element vocabulary across FBD, LD, and IL editors** — most editor elements (`Network`, `Box`, `Box with EN/ENO`, `Assignment`, `Input`, `Label`, `Jump`, `Return`, `Branch`, `Execute`) live in a "FBD/LD/IL Element" topic series, and only a small set is LD-exclusive (Contact, Coil, Branch Start/End, Closed Branch — covered in [15-ld-elements.md](./15-ld-elements.md)).

This file catalogs the **FBD-applicable elements** with the per-element facts, the PLCopenXML element each maps to, and notes for the LSP. IL-specific instructions (`JMP`, `RET`, `LD`, `ST`, etc.) are referenced where the docs say the IL form is the textual equivalent — but full IL coverage is out of scope; FBD/LD is our target.

The chain of pages reachable from the landing-page "Next" link, in order:

1. Element: Network → `_cds_fbd_ld_il_element_network.html`
2. Element: Box → `_cds_fbd_ld_il_element_box.html`
3. Element: Assignment → `_cds_fbd_ld_il_element_assignment.html`
4. Element: Box with EN/ENO → `_cds_fbd_ld_il_element_box_en_eno.html`
5. Element: Input → `_cds_fbd_ld_il_element_input.html` (input pin on a box)
6. Element: Jump Label → `_cds_fbd_ld_il_element_label.html`
7. Element: Jump → `_cds_fbd_ld_il_element_jump.html`
8. Element: Return → `_cds_fbd_ld_il_element_return.html`
9. Element: Branch → `_cds_fbd_ld_il_element_branch.html`
10. Element: Execute → `_cds_fbd_ld_il_element_execute.html`
11. → continues into LD-specific elements (Contact, Coil, ...)

The docs are **terse**. Most pages are 1–3 short paragraphs plus an icon and a "see Insert X command" link. There is **no PLCopenXML mapping in the CODESYS docs themselves** — the XML element names below are derived from IEC 61131-10 / PLCopen TC6 schema knowledge and our own [fbd-authoring](../../../.claude/skills/fbd-authoring) skill.

## Element catalog

### Network

> **Page:** `_cds_fbd_ld_il_element_network.html`
> **PLCopenXML:** rendering surface only — the `<FBD>` (or `<LD>`) body container holds the network's child elements directly; there is no per-network wrapper element in PLCopenXML. CODESYS-XML (proprietary `*.exp`) does serialize each network separately, but PLCopen-XML inlines them.

A network is "the base unit of an FBD or LD program." Networks are displayed as a numbered list inside the editor; each network can contain logical/arithmetic expressions, POU/function/FB calls, jumps, or return statements.

- Each network can carry a **title** (first line) and a **comment** (second line). A network can also carry a **label** (used as the destination for a `Jump`).
- IL POUs require at least one network containing all IL instructions.
- Display of titles, comments, and inter-network separators is controlled by CODESYS options under "FBD, LD, and IL editor."

**Related command:** Insert Network.

**Gotcha:** The CODESYS UI shows networks as discrete numbered blocks, but PLCopenXML's `<FBD>` and `<LD>` bodies are flat lists of elements. Tooling that round-trips to CODESYS-XML must reconstruct network boundaries from element positioning or from `localId` ranges. The bridge currently treats network boundaries as opaque metadata.

### Box

> **Page:** `_cds_fbd_ld_il_element_box.html`
> **PLCopenXML:** `<block>` (with `typeName` for the called POU/function/FB; `instanceName` for FB instances; `<inputVariables>` / `<outputVariables>` / `<inOutVariables>` for the pins). See [fbd-authoring](../../../.claude/skills/fbd-authoring) for the `addData` envelope CODESYS expects.

A box is a container for "IEC function blocks, IEC functions, library function blocks, or operators." It accepts "any number of inputs and outputs."

- An icon is shown inside the box when the **Show box symbol** option is enabled in CODESYS options (FBD/LD/IL editor category).
- When the interface of the called POU changes (extra parameter, renamed pin), use the **Update Parameters** command rather than reinserting the box.
- Extendable boxes (`ADD`, `OR`, `AND`, `MUL`, `SEL`, …) accept additional inputs via the **Insert Input** command (`Ctrl+Q`).

**Related commands:** Insert Box (`Ctrl+B`), Update Parameters, Insert Input.

**Gotchas:**
- Operator calls (e.g. `ADD`, `AND`) use `<block typeName="ADD">` with no `instanceName` — they're stateless functions. FB calls require both `typeName` and `instanceName`.
- "Show box symbol" is purely cosmetic, but its presence in CODESYS-XML may affect round-trip stability of the bridge.

### Box with EN/ENO

> **Page:** `_cds_fbd_ld_il_element_box_en_eno.html`
> **PLCopenXML:** `<block>` with `executionOrderId` and an extra input pin named `EN` and output pin named `ENO`, both `BOOL`. The PLCopen schema models `EN`/`ENO` as ordinary pins, not a separate element type.

A box variant available **in FBD and LD only** (not IL). It adds:
- **`EN` input (BOOL):** when `FALSE` at the time of the POU call, the box's operations are **not executed**.
- **`ENO` output (BOOL):** mirrors the `EN` input's value.

**Related command:** Insert Box with EN/ENO.

**Gotchas:**
- ENO does *not* signal "no error" — it's a tautological echo of EN. Don't model it as a success flag.
- IL has no graphical EN/ENO box; the conditional-call modifier (`CALC`/`CALCN`) is the IL equivalent.
- `EN`-guarded boxes still appear in execution-order numbering; their `executionOrderId` is preserved even when skipped at runtime.

### Assignment

> **Page:** `_cds_fbd_ld_il_element_assignment.html`
> **PLCopenXML:** `<outVariable>` when the assignment target is the network's "sink" pin; for explicit pin-to-variable assignment the IEC schema uses `<outVariable expression="varName">`.

In FBD, a newly inserted assignment is rendered as "a line with three question marks after it." In LD, it appears as a coil with three question marks above it. The user replaces the `???` placeholder with the target variable name; the Input Assistant supports this.

In IL, the `LD` (load) and `ST` (store) operators handle assignment.

**Related commands:** Insert Assignment; see also [Modifiers and Operators in IL](https://content.helpme-codesys.com/en/CODESYS%20LD%20FBD/_cds_il_modificators_operators.html).

**Gotcha:** The CODESYS UI renders an LD-mode assignment as a coil-shaped graphic, even though it's an `<outVariable>` in PLCopenXML — *not* an LD coil (`<coil>`). The distinguishing factor is whether the target variable is a `BOOL` writing into a power-rail-driven coil, or any-typed variable receiving a non-rail signal.

### Input (input pin on a box)

> **Page:** `_cds_fbd_ld_il_element_input.html`
> **PLCopenXML:** `<inputVariables><variable>...</variable></inputVariables>` child of `<block>`. The `formalParameter` attribute names the POU's parameter; the connected source goes in `<connection refLocalId="..."/>`.

A pin on a box. The **maximum number of inputs depends on the type of box** (e.g. `ADD` is unbounded, a regular FB has fixed pins). A freshly added input shows `???` until the user replaces it with a variable, constant, or connection.

**Related command:** Insert Input (`Ctrl+Q`) — only effective on **extendable** boxes (`ADD`, `OR`, `AND`, `MUL`, `SEL`).

**Gotcha:** "Insert Input" silently no-ops on non-extendable boxes. The LSP should not flag missing pins on extendable operators as errors — they're variadic.

> **Note on `<inVariable>` (free-standing input):** The docs do **not** have a dedicated page for free-standing input variables (the box shown floating in space whose output wires into another box's pin). In PLCopenXML this is `<inVariable expression="varName">` and is the standard way to wire a named operand into a box without an explicit pin label. Treat it as the "source" counterpart of `<outVariable>`.

### Jump Label

> **Page:** `_cds_fbd_ld_il_element_label.html`
> **PLCopenXML:** `<label label="LabelName">` element placed at the start of a network (or its `label` attribute on the network/`<FBD>` container in CODESYS-XML).

An optional identifier for a network in FBD/LD, used as the destination of a `Jump`. When a jump is inserted into a network, an editable Label field is automatically created.

**Related command:** Insert Label.

**Gotcha:** Labels are network-scoped within a POU body. A `Jump` targeting an unknown label is a hard error (CODESYS compile error; LSP should diagnose with a dangling-reference message).

### Jump

> **Page:** `_cds_fbd_ld_il_element_jump.html`
> **PLCopenXML:** `<jump label="TargetLabel">` with an input connector for the gating condition. The jump fires when the boolean input is `TRUE`.

In FBD/LD, a jump is inserted either directly before an input, directly after an output, or at the end of the network — depending on the cursor position. The user **must** specify the target Jump Label immediately after insertion.

In IL, the equivalent is the `JMP` instruction.

**Related command:** Insert Jump.

**Gotchas:**
- Unconditional jumps in FBD are still modeled as `<jump>` with an input — that input is wired to a constant `TRUE` (often via a free-standing `<inVariable expression="TRUE">`).
- Jumping into the middle of a network from outside is not supported; jumps target whole networks via the network's label.
- Cross-POU jumps are not supported — labels are POU-local.

### Return

> **Page:** `_cds_fbd_ld_il_element_return.html`
> **PLCopenXML:** `<return>` element with a single boolean input connector.

"The element immediately interrupts the execution of the box when the input of the `RETURN` element becomes `TRUE`." In FBD/LD networks, the Return instruction can be placed either parallel to or after preceding elements.

In IL, the equivalent is the `RET` instruction.

**Related command:** Insert Return.

**Gotcha:** A conditional Return in FBD/LD short-circuits execution of *the remaining networks in the POU body*, not just the current network. Tooling that does dataflow analysis must treat Return as terminating subsequent execution-order entries.

### Branch (parallel paths within a network)

> **Page:** `_cds_fbd_ld_il_element_branch.html`
> **PLCopenXML:** "Open branches" in FBD are rendered through duplicate connection wires — there's no dedicated `<branch>` element in the PLCopen schema for FBD. CODESYS-XML serializes them under a proprietary structure. (LD's *closed branches* are different — they're modeled via parallel `<leftPowerRail>`/`<rightPowerRail>` connections and dedicated branch elements. See [15-ld-elements.md](./15-ld-elements.md).)

The Branch element "represents an open branch" — it "splits the processing line from the current cursor position onwards into two subnetworks which are executed in succession from top to bottom." Multiple nested branches are allowed.

- Each branch point displays a **marker symbol** (rectangle) used to target additional commands.
- **Limitation (verbatim from the docs):** "The Copy, Cut, and Paste commands are not available for subnetworks."
- To delete a subnetwork: first delete all elements inside it, then delete the marker symbol.

**Related commands:** Insert Branch, Insert Branch Above, Insert Branch Below.

**Gotcha:** Open branches in FBD execute **sequentially top-to-bottom**, not concurrently. This contrasts with LD parallel contacts, which are logically simultaneous (OR'd). Code reviewers and AI generators should not assume branch parallelism implies independence.

### Execute (inline ST)

> **Page:** `_cds_fbd_ld_il_element_execute.html`
> **PLCopenXML:** No standard PLCopenXML element. CODESYS represents the Execute box as a `<block>` with a vendor-extension `addData` payload carrying the inline ST source. Treat as opaque on round-trip.

The Execute element is a box that allows direct insertion of ST (Structured Text) code inside FBD/LD networks. Drag it from the Toolbox into the POU implementation, then click **Enter ST code here** to open an input field for multi-line ST.

**Related command:** None documented in the source page (drag-from-Toolbox is the documented entry point).

**Gotcha:** Execute boxes contain a nested ST body that the LSP currently does *not* parse. Diagnostics inside an Execute block are surfaced only at compile time by CODESYS. P3 may add an inline-ST parser pass for these.

## What the docs do NOT cover

The CODESYS documentation pages reached from the FBD/LD/IL elements landing are **deliberately terse** and omit several things our LSP and corpus tests need:

- **PLCopenXML element-to-CODESYS-element mapping.** Nowhere in the docs is the FBD/LD element vocabulary cross-referenced with the IEC 61131-10 XML schema. The mappings above are inferred from PLCopen TC6 spec knowledge and round-trip experiments documented in [fbd-authoring](../../../.claude/skills/fbd-authoring).
- **Execution order semantics.** The docs say networks run "top to bottom" but never specify whether ENO short-circuits, whether parallel branches are evaluated lazily, or how `executionOrderId` is assigned to elements within a network.
- **Connection / wire model.** The docs describe inserting boxes and pins but never describe the wire/connection element directly — it's implicit. PLCopenXML uses `<connection refLocalId="N" formalParameter="..."/>` inside `<inputVariables>` / `<outputVariables>`.
- **Comment elements.** Free-standing comment boxes inside an FBD body are not documented at the element level (only as a network-header line). PLCopenXML has `<comment>` for these.
- **Pragma support inside graphical bodies.** Pragmas (`{attribute ...}`) inside FBD/LD networks are not discussed.
- **Variable typing / coercion at pin boundaries.** The "input shows `???` — replace with variable or constant" guidance is silent on type compatibility, narrowing, or implicit conversion at pin boundaries.

These gaps are where the **conformance test corpus** must provide ground truth (P5: bridge recording against a real TwinCAT/CODESYS project).

## Notes for tooling

**Lexer / parser (relevant ST keywords also recognized in FBD/LD network text fields):**
- Network label names are identifiers, validated by [08-identifiers.md](./08-identifiers.md) rules.
- Box `typeName` resolution shares the ST type-name resolution path (see [09-shadowing.md](./09-shadowing.md)).

**LSP diagnostic candidates:**
- Jump → unknown label → error
- Box with mismatched `formalParameter` against the called POU's interface → error (after Update Parameters has not been run)
- Return on a `FUNCTION` (which has no early-exit semantics in some controllers) → warning
- Unconnected required input pin on a box → warning (`check-dangling-connection.ts` already does this — see `src/semantic/checks/_fbd/check-dangling-connection.ts`)
- Branch nested inside an `EN`-disabled box → noop warning

**Hover augmentation:**
- Hovering on a box shows: `typeName`, `instanceName` (if any), called POU's signature, link to the page above
- Hovering on a Jump shows: target label name + a peek of the destination network
- Hovering on EN/ENO shows the "ENO mirrors EN" semantics

**Completion:**
- Inside an empty network: offer Box, Assignment, Jump, Return, Branch, Execute as element kinds
- Inside a `???` placeholder: offer the standard expression completion list

Stage 5 deep-dives this into `src/reference/fbd-elements.ts`.
