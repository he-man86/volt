# 07 — Pragmas

> **Source:** https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_struct_reference_pragmas.html
> **Retrieved:** 2026-05-26
> **CODESYS version:** V3.5.22.0

## Summary

Pragmas are compile-time directives written inside curly braces `{ ... }` that influence one or more variables, POUs, or DUTs during the compile or precompile process. They are **only supported in text editors** (ST + declaration editors) — graphical languages don't see them.

This is the single most under-documented part of the language in the wild. Pragmas silently change behavior — pointers to memory survive online-change, variables get hidden from monitoring, functions run before global init — and the AI has no way to know any of this from syntax. **Knowing the pragma catalog is the largest single AI quality win.**

There are four pragma categories:

| Category | Form | Purpose |
|---|---|---|
| Message | `{text 'msg'}`, `{info 'msg'}`, `{warning 'msg'}`, `{error 'msg'}` | Emit messages during compile |
| Attribute | `{attribute 'name'}` or `{attribute 'name' := 'value'}` | Modify behavior of the decorated symbol |
| Conditional | `{IF}` / `{ELSIF}` / `{ELSE}` / `{END_IF}` + `{define}` / `{undefine}` | Conditional compilation |
| Region | `{region 'name'}` / `{end_region}` | Source folding only |

## Message pragmas

Generate messages in the CODESYS *Messages* view. Allowed in POUs, statements, variable declarations.

| Form | Severity | Filterable |
|---|---|---|
| `{text 'msg'}` | (none) | ✔ |
| `{info 'msg'}` | Message | ✔ |
| `{warning 'msg'}` | Warning (emits `C0373`) | ✔ |
| `{error 'msg'}` | Error | ✔ |

`{warning}` differs from `{attribute 'obsolete'}` — it's a **local, position-specific** warning, not a centrally-defined "this symbol is deprecated" warning.

Example:
```st
PROGRAM PLC_PRG
VAR
  iVar : INT; {info 'Info0: This is for your information.'}
END_VAR
{warning 'W01: This is a warning'}
iVar := iVar + 1;
```

## Conditional pragmas

Used **only in implementation parts** of ST POUs (not declarations, with one exception below). Compiler evaluates these at pre-compile time; the unselected branches are stripped entirely.

```st
{IF defined (pou: CheckBounds)}
  arrTest[CheckBounds(0,i,10)] := arrTest[CheckBounds(0,i,10)] + 1;
{ELSIF defined (DEF0815)}
  iCnt0815 := iCnt0815 + 1;
{ELSE}
  arrTest[i] := arrTest[i] + 1;
{END_IF}
```

### Compiler defines

| Form | Effect |
|---|---|
| `{define <name>}` | Set `<name>` as a `BOOL` define |
| `{define <name> <string>}` | Set `<name>` with string value, e.g. `{define DEF0123 '123'}` |
| `{undefine <name>}` | Remove a previously-set define |

Defines can also be set globally in the POU's **Properties → Build → Compiler-Defines** field (comma-separated list of bare names, no `{define}` syntax).

### Conditional operators

| Operator | TRUE when… |
|---|---|
| `defined (<id>)` | `<id>` has been `{define}`d and not `{undefine}`d |
| `defined (variable: <name>)` | A variable named `<name>` is declared in the current scope |
| `defined (type: <name>)` | A data type named `<name>` is declared |
| `defined (pou: <name>)` | A POU named `<name>` exists (FB / function / program / action / method / interface) |
| `defined (resource: <name>)` | **Not implemented yet** per docs |
| `defined (task: <name>)` | A task with `<name>` is defined |
| `defined (IsLittleEndian)` | CPU is little-endian (FALSE for Motorola byte order) |
| `defined (IsSimulationMode)` | Application runs on a simulated device |
| `defined (IsFPUSupported)` | Hardware FPU is available (REAL ops are hardware-fast vs emulated) |
| `hasattribute (pou: <pou>, '<attr>')` | The first line of `<pou>`'s declaration has `{attribute '<attr>'}` |
| `hasattribute (variable: <var>, '<attr>')` | The variable's declaration is preceded by `{attribute '<attr>'}` |
| `hasconstanttype (<const>, TRUE)` / `hasconstanttype (<const>, FALSE)` | Whether the constant is/isn't replaced at compile (depends on project settings + `const_replaced` / `const_non_replaced` attributes) |
| `hasconstantvalue (<const>, <value>, <op>)` | Compare constant to value with operator (`<`, `<=`, `=`, `<>`, `>=`, `>`) |
| `hastype (variable: <var>, <type>)` | Variable has the named data type. Possible types: every elementary type |
| `hasvalue (PackMode, '<n>')` | Device's pack mode matches `<n>` (depends on device description, not pragma) |
| `hasvalue (RegisterSize, '<bits>')` | CPU register size matches: `16`/`32`/`64` |
| `hasvalue (<define-ident>, '<string>')` | A `{define}` exists with that string value |
| `project_defined (<define>)` | Global define is present in project settings → Compile options (**CODESYS V3.5 SP20+ only**) |
| `NOT <op>` | Boolean negation |
| `<op> AND <op>` | Both true |
| `<op> OR <op>` | Either true |
| `(<op>)` | Grouping |

### `project_defined` exception — usable in declarations

This is the **one** conditional operator that works in declaration parts. Allowed constructs inside its block:
- Variable declarations
- Comments
- Attribute declarations
- Pragma statements

**Not allowed:** full `VAR ... END_VAR` blocks, full POU declarations, `VAR_INPUT`/`VAR_OUTPUT`/`VAR_IN_OUT` scopes.

```st
{IF project_defined(define1)}
  x : DINT;          (* OK *)
{END_IF}

{IF project_defined(define1)}
  VAR x : DINT; END_VAR    (* NOT OK *)
{END_IF}
```

## Region pragma

```st
{region 'Initialization'}
  ...
{end_region}
```

Source-folding hint only. No semantic effect. Region pragmas can be nested. Works in the ST editor and all declaration editors.

## Custom (user-defined) attributes

Any attribute name CODESYS doesn't recognize is treated as a user-defined attribute. Useful for downstream conditional compilation via `hasattribute`. **Convention: prefix with a vendor/library name to avoid collisions** (device manufacturers should use their own vendor prefix).

```st
{attribute 'vision'}     (* user-defined *)
FUNCTION fun1 : INT
VAR_INPUT i : INT; END_VAR
END_FUNCTION
```

Then elsewhere:
```st
{IF hasattribute (pou: fun1, 'vision')}
  ergvar := fun1(ivar);
{END_IF}
```

## Attribute pragma catalog (alphabetical)

Each entry includes: **purpose**, **syntax**, **insert location**, and **gotchas/notes**. Source URL = `https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_pragma_attribute_<slug>.html` for each.

---

### `call_after_global_init_slot`

**Purpose.** Marks a function/program to be called after global initialization. Order across multiple marked POUs is set by the slot number.

**Syntax.** `{attribute 'call_after_global_init_slot' := '<slot>'}`

**Insert location.** First line above the declaration part of a `FUNCTION` or `PROGRAM`.

**Gotchas.**
- `VAR_INPUT` declarations in these POUs cause compile errors (inputs are unknown at implicit call time).
- The POU is **only called if compiled and downloaded**. If never called elsewhere, the compiler may drop it unless you also add `{attribute 'linkalways'}`.

---

### `call_after_init`

**Purpose.** Method runs implicitly after `FB_Init` AND after initial assignments like `T1 : TON := (PT := T#500ms)`. The hook fires once per instance, before tasks start.

**Syntax.** `{attribute 'call_after_init'}` (no value).

**Insert location.** First line above the declaration of the method **and** in the first line above the function block body's declaration part.

**Gotchas.**
- `VAR_INPUT` → compile error.
- Same `linkalways` issue as above.
- Derived POUs that extend a base using `call_after_init` **must also use it**, ideally on a method of the same name+signature that calls `SUPER^.MyInit()`. Method name is free EXCEPT `FB_Init`, `FB_Reinit`, `FB_Exit`.
- Available since compiler 3.4.1.0.
- Breakpoints in this method may behave unexpectedly.

---

### `call_after_online_change_slot`

**Purpose.** Called after each online change, in slot order.

**Syntax.** `{attribute 'call_after_online_change_slot' := '<slot>'}`

**Insert location.** First line above the declaration part of `FUNCTION` or `PROGRAM`.

**Gotchas.** Code runs during online change while the application is paused → can cause jitter. Keep the code small. Same `VAR_INPUT`/`linkalways` constraints.

---

### `call_before_global_exit_slot`

**Purpose.** Called before `GlobalExit` (which runs before download/reset). Lets you tear down state before FBs are destroyed.

**Syntax.** `{attribute 'call_before_global_exit_slot' := '<slot>'}`

**Insert location.** First line above the declaration part of `FUNCTION` or `PROGRAM`.

**Gotchas.** Same `VAR_INPUT`/`linkalways` constraints. Interacts with `FB_Exit` for affected FBs.

---

### `call_on_type_change`

**Purpose.** Method is called when the data type of an FB **referenced** by the parent FB (via `POINTER TO X` or `REFERENCE TO X`) changes.

**Syntax.** `{attribute 'call_on_type_change' := '<comma-separated FB names>'}`

**Insert location.** Line above the method declaration.

**Example.**
```st
{attribute 'call_on_type_change' := 'FB_B, FB_C'}
METHOD METH_react_on_type_change : INT
```

---

### `conditionalshow`

**Purpose.** Hides identifiers of a compiled library from application code at the UI level (Library Manager, Input Assistant, monitoring, symbol config). POUs remain callable; variables remain readable in code but invisible in UI. Toggleable via command-line literal.

**Syntax.** `{attribute 'conditionalshow' := '<some text>'}` (literal is optional; without it, identifier is always hidden).

**Insert location.** First line above a function block or above a variable.

**Use case.** Library development — restrict which symbols application devs see while preserving access for library maintainers.

---

### `conditionalshow_all_locals`

**Purpose.** Same as `conditionalshow` but applied at FB level: hides ALL local variables of the FB.

**Syntax.** `{attribute 'conditionalshow_all_locals' := '<some text>'}`

**Insert location.** First line above the FB declaration.

---

### `const_replaced` / `const_non_replaced`

**Purpose.** Override the project's "Replace constants" compile option per-constant.

- `const_replaced`: force replacement (constant is inlined regardless of project setting).
- `const_non_replaced`: force NO replacement (constant is left as a symbol → exportable in Symbol Configuration).

**Syntax.** `{attribute 'const_replaced'}` / `{attribute 'const_non_replaced'}` (no value).

**Insert location.** Line above the constant's declaration line.

**Gotcha.** Only effective on **scalar types**, not on arrays or structures.

---

### `dataflow`

**Purpose.** In FBD/LD/IL editors, controls which input and which output of an FB is connected to the previous/next FB.

**Syntax.** `{attribute 'dataflow'}` (no value).

**Insert location.** Line above the input or output variable declaration.

**Constraint.** Only **one input AND one output** per FB may be decorated with `dataflow`. If absent, the editor uses the topmost matching-type pair.

---

### `displaymode`

**Purpose.** Per-variable override for the monitoring display format.

**Syntax.** `{attribute 'displaymode' := 'bin' | 'binary' | 'dec' | 'decimal' | 'hex' | 'hexadecimal'}`

**Insert location.** Line above the variable declaration.

---

### `enable_dynamic_creation`

**Purpose.** Required for using the `__NEW` operator on a function block.

**Syntax.** `{attribute 'enable_dynamic_creation'}`

**Insert location.** First line in the FB declaration.

---

### `estimated-stack-usage`

**Purpose.** Provides an estimated stack-size value (in bytes) for a method with recursive calls so the stack check doesn't issue a warning.

**Syntax.** `{attribute 'estimated-stack-usage' := '<bytes>'}`

**Insert location.** First line above the method's declaration.

---

### `ExpandFully`

**Purpose.** When an `ARRAY` is used as an input variable of a referenced visualization, this makes the individual array members visible in the visualization's Properties dialog.

**Syntax.** `{attribute 'ExpandFully'}`

**Insert location.** Line above the array variable declaration in the visu's interface editor.

---

### `global_init_slot`

**Purpose.** Defines the initialization order of GVLs and POUs. See [12-global-init-slots.md](./12-global-init-slots.md) for the full slot table.

**Syntax.** `{attribute 'global_init_slot' := '<slot>'}`

**Insert location.** Line above `VAR_GLOBAL` or above the POU declaration.

**Defaults.**
- POUs (program / FB): `50000`
- GVLs: `49990`
- Lower → earlier

**Constraints.**
- Initialization of literal values (`1`, `'hello'`, `3.6`, base-type constants) is unaffected.
- Constants initialize before variables in the same slot.
- If multiple POUs share a slot value, order between them is **undefined**.

---

### `hide`

**Purpose.** Hides variables/POUs from the CODESYS UI (Library Manager, Input Assistant, "List components", Monitoring, Symbol Configuration). Code can still reference them if the instance path is known.

**Syntax.** `{attribute 'hide'}`

**Insert location.** Line above the variable declaration, or first line of the POU.

**⚠ Important:** CODESYS docs note `hide` "does not have the desired effect in most cases" — prefer `conditionalshow` for new code.

---

### `hide_all_locals`

**Purpose.** FB-level: hides all local variables of the FB from List Components, Input Assistant, Symbol Configuration, monitoring, and online declaration view.

**Syntax.** `{attribute 'hide_all_locals'}`

**Insert location.** First line above the FB declaration.

---

### `implicit-parameter`

**Purpose.** A POU input variable of type `STRING`/`WSTRING` (or `POINTER TO` either) is auto-populated with context about the **calling** POU. Use case: precise error messages without explicit parameter plumbing.

**Syntax.** `{attribute 'implicit-parameter' := '<value>'}`

| Value | Returns |
|---|---|
| `'pouname'` | Qualified name of the caller |
| `'position'` | Human-readable call position |
| `'instance-path'` | Instance path of the caller |

**Insert location.** Above a `VAR_INPUT` of type `STRING`/`WSTRING`/`POINTER TO STRING/WSTRING`.

**Allowed in:** `PROGRAM`, `FUNCTION`, `METHOD` (including interface methods).
**Not inheritable.**

---

### `initialize_on_call`

**Purpose.** Input variables of the FB are re-initialized **on every call**. Useful when a `POINTER TO` input may have been invalidated by online change.

**Syntax.** `{attribute 'initialize_on_call'}`

**Insert location.** First line of the FB declaration AND above each input variable to initialize.

---

### `init_namespace`

**Purpose.** A `STRING`/`WSTRING` variable declared in a library FB is initialized to the **library's current namespace** when the library is used in a project.

**Syntax.** `{attribute 'init_namespace'}`

**Insert location.** Above the variable declaration inside a library FB.

---

### `init_on_onlchange`

**Purpose.** Variable is re-initialized on every online change.

**Syntax.** `{attribute 'init_on_onlchange'}`

**Insert location.** Above the variable declaration.

**Gotcha — "fast online change":** Since compiler 3.5.0.0, minor changes use "fast online change" which does NOT generate init code. For variables with this attribute, that means **no re-init** during a fast online change. To guarantee the attribute fires, set the compiler-define `no_fast_online_change` on the application (Build → Compiler-Defines).

---

### `instance-path`

**Purpose.** A `STRING` variable is initialized with the device-tree path of the POU it belongs to. Useful for error messages.

**Syntax.** `{attribute 'instance-path'}`

**Required companions:**
- `{attribute 'reflection'}` on the parent FB.
- `{attribute 'noinit'}` on the same STRING variable.

**Insert location.** Above a `STRING` variable.

**Gotcha.** The instance path can exceed 255 chars — string will truncate if the variable's `STRING(n)` is too small. Use `STRING(255)` or larger.

---

### `io_function_block`, `io_function_block_mapping`

**Purpose.** Makes an FB available in the *Select Function Block* dialog for I/O channel mapping in device configuration.
- `io_function_block` → marks the FB as eligible.
- `io_function_block_mapping` → marks an FB parameter as the default channel-mapped one.

**Syntax.** `{attribute 'io_function_block'}` / `{attribute 'io_function_block_mapping'}`

**Insert location.** First line above the FB declaration, and above the parameter declaration.

**Note.** Multiple parameters can carry `io_function_block_mapping`; for a given channel, CODESYS picks the **first matching type**.

---

### `is_connected`

**Purpose.** A `BOOL` variable inside an FB is set to TRUE iff the named input has received an external assignment in the call. Lets the FB know which of its inputs were wired.

**Syntax.** `{attribute 'is_connected' := '<input variable name>'}`

**Required companion.** `{attribute 'reflection'}` on the FB.

**Insert location.** Above the BOOL variable declaration.

---

### `linkalways`

**Purpose.** Forces the compiler to always include a POU or GVL in the build, even if no one calls it. Required when the only "caller" is implicit (init slot, attribute-decorated method) or for libraries.

**Syntax.** `{attribute 'linkalways'}`

**Insert location.** First line of the POU's declaration.

**Alternative.** *Build* tab → *Link always* option in the POU's properties.

---

### `monitoring`

**Purpose.** Allows properties and function calls to be monitored in IEC editor / watch list.

**Syntax.**
- `{attribute 'monitoring' := 'variable'}` — read-only monitoring (no side effects)
- `{attribute 'monitoring' := 'call'}` — full call with potential side effects on the property's getter/setter

**Insert location.** In the declaration of a property block.

**⚠ Side-effect warning.** Using `'call'` invokes the getter/setter at every monitor tick. Side effects in Get/Set will fire.

---

### `monitoring_display`

**Purpose.** When monitoring an FB or struct instance, additionally show the value of a named member in the top line of the monitoring widget.

**Syntax.** `{attribute 'monitoring_display' := '<member name>'}`

**Insert location.** Above the first line of the FB/struct declaration.

---

### `monitoring_encoding`

**Purpose.** Declares that a `STRING` (or alias-of-STRING) variable holds UTF-8 — monitoring decodes it accordingly.

**Syntax.** `{attribute 'monitoring_encoding' := 'UTF8'}` or `'UTF-8'` (docs use both).

**Insert location.** Above the variable declaration.

---

### `no_assign` / `no_assign_warning`

**Purpose.** Prevents instance-to-instance assignment of an FB.

- `no_assign` → compile **error** on `inst1 := inst2`.
- `no_assign_warning` → compile **warning** instead.

**Use case.** FBs containing pointers — value-assignment copies the pointers, which usually breaks the original FB's lifecycle (e.g., `fb_exit` running twice on shared resources).

**Syntax.** `{attribute 'no_assign'}` / `{attribute 'no_assign_warning'}`

**Insert location.** Top line of the FB declaration.

---

### `no_check`

**Purpose.** Suppresses Implicit Check function calls (e.g., array-bounds check, division-by-zero check) for the decorated POU.

**Syntax.** `{attribute 'no_check'}`

**Insert location.** First line in the POU's declaration.

**⚠ Cascade rule.** Applies to **all child objects** of the POU (e.g., its actions).

**Use case.** Performance-critical FBs already verified safe.

---

### `no_copy`

**Purpose.** During online change, prevent this specific variable from being copied. The variable is re-initialized on the new instance instead.

**Syntax.** `{attribute 'no_copy'}`

**Insert location.** Line above the variable declaration.

**Use case.** Local pointer variables — if the target has moved, the old pointer is invalid. Re-init from scratch is safer.

---

### `no-exit`

**Purpose.** Suppresses the `FB_Exit` call for a specific FB **instance** (not the FB type).

**Syntax.** `{attribute 'no-exit'}`

**Insert location.** Line above the instance declaration in the parent POU's VAR section.

---

### `no_instance_in_retain`

**Purpose.** Forbid this FB from being declared as a `RETAIN` variable. Compile error if attempted.

**Syntax.** `{attribute 'no_instance_in_retain'}`

**Insert location.** Line above the FB declaration.

**Use case.** FBs with pointers / external resources that shouldn't survive across power cycles.

---

### `no_virtual_actions`

**Purpose.** For SFC-derived FBs: prevents subclasses from overriding the base FB's actions.

**Syntax.** `{attribute 'no_virtual_actions'}`

**Insert location.** Top line of the FB declaration.

---

### `noinit` (alias forms: `no_init`, `no-init`)

**Purpose.** Variable is **not** implicitly initialized at startup/reset; retains whatever bit pattern is in memory.

**Syntax.** `{attribute 'noinit'}` / `{attribute 'no_init'}` / `{attribute 'no-init'}` — all equivalent.

**Insert location.** Line above the variable declaration.

**Example.** `iA : INT` resets to 0 on reset; `iB : INT` with `noinit` keeps its prior value.

---

### `obsolete`

**Purpose.** Issues a custom compile warning whenever the data type is used in the project.

**Syntax.** `{attribute 'obsolete' := '<user-defined text>'}`

**Insert location.** Line of, or above, the data type definition.

**Differs from `{warning}` pragma:** `obsolete` is **centrally defined** at the type and fires on every usage. `{warning}` is a single-line, single-position message.

---

### `pack_mode`

**Purpose.** Defines memory packing for a struct/DUT.

**Syntax.** `{attribute 'pack_mode' := '<value>'}`

| `<value>` | Meaning |
|---|---|
| `0` | Aligned: all vars at byte addresses, no gaps |
| `1` | 1-byte aligned |
| `2` | 2-byte aligned: 1-byte at bytes, 2/4/8-byte at even addresses, max 1-byte gap. STRINGs always at bytes. |
| `4` | 4-byte aligned: 1-byte at bytes, 2-byte at even, 4/8-byte at addr÷4, max 3-byte gap |
| `8` | 8-byte aligned: 1-byte at bytes, 2-byte at even, 4-byte at addr÷4, 8-byte at addr÷8 |

**Insert location.** Above the struct/DUT declaration.

---

### `pingroup`

**Purpose.** Groups FB pins (inputs/outputs) for collapsible display in FBD/LD editor.

**Syntax.** `{attribute 'pingroup' := '<group name>'}`

**Insert location.** Line above each input/output declaration that belongs to the group.

**Note.** Multiple groups distinguished by name. CODESYS stores expanded/collapsed state per FB box in the project options. Variables without `pingroup` are always displayed.

---

### `pin_presentation_order_inputs`, `pin_presentation_order_outputs`

**Purpose.** Force a specific display order for FB inputs/outputs in CFC/FBD/LD.

**Syntax.**
```
{attribute 'pin_presentation_order_inputs'  := '<name1>,<name2>,...'}
{attribute 'pin_presentation_order_outputs' := '<name1>,<name2>,...'}
```

Use `*` as a placeholder for "all unspecified names". Without `*`, unspecified pins are appended at the end.

**Insert location.** Top line of the FB declaration.

**⚠ Mutually exclusive with `pingroup`** — when `pingroup` is present, `pin_presentation_order_*` is ignored.

---

### `ProcessValue`

**Purpose.** Marks a structure member as the "process value". In the CFC editor, *Use Attributed Members as Input* connects the struct to a scalar input using this member.

**Syntax.** `{attribute 'ProcessValue'}`

**Insert location.** Line above the affected struct member.

---

### `qualified_only`

**Purpose.** Force variables in a GVL or values in an ENUM to be referenced only via the qualified form: `gvl.var`, `MyEnum.RED`.

**Syntax.** `{attribute 'qualified_only'}`

**Insert location.** Line above `VAR_GLOBAL` in a GVL, or above an enum declaration.

**Effect.** A bare reference like `iVar := 5;` becomes a compile error if `iVar` lives in a `qualified_only` GVL; you must write `GVL.iVar := 5;`. Strongly recommended for project hygiene — prevents shadowing surprises.

---

### `strict`

**Purpose.** Apply strict type-checking to a single POU. Implicit conversions that the compiler would normally warn about become hard errors.

**Syntax.** `{attribute 'strict'}`

**Insert location.** Line above a POU declaration (`FUNCTION_BLOCK`, `FUNCTION`, or `PROGRAM`).

**Effect.** Inside a strict POU the compiler refuses:
- Implicit BOOL ↔ BYTE conversions
- Implicit signed ↔ unsigned conversions
- Implicit narrowing assignments (e.g. `INT` into `SINT` without explicit cast)
- Implicit STRING ↔ pointer conversions

**Use case.** Opt one new POU into strict checking even when the project's compiler settings are permissive — gradual migration path for legacy code that can't switch project-wide.

---

### `symbol`

**Purpose.** Per-variable override for what the Symbol Configuration / OPC UA Communication object exports. Lets a GVL be marked as fully-exported by default but turn off a single sensitive variable, or vice versa.

**Syntax.** `{attribute 'symbol' := '<mode>'}` where `<mode>` is one of:

- `'none'` — exclude this variable from the symbol configuration
- `'read'` — read-only export (OPC UA clients can read but not write)
- `'write'` — write-only export (rare; OPC UA clients can write but not read)
- `'readwrite'` — full read+write export

**Insert location.** Line above a variable declaration inside a `VAR_GLOBAL` block. Also accepted at GVL-top to set a project-wide default for that GVL.

**Effect.** Overrides the GVL- or project-level export status for the variable that immediately follows. Has no observable effect when the project doesn't actually have a Symbol Configuration / OPC UA object — but stays valid syntax in case one is added later.

---

### `reflection`

**Purpose.** Marks an FB as "reflective" — required for the compiler to scan its variables looking for `instance-path` or `is_connected` attributes.

**Syntax.** `{attribute 'reflection'}`

**Use case.** Performance optimization: only reflective FBs get the extra compile-time scan.

---

### `subsequent`

**Purpose.** Allocate consecutive variables in memory (a single contiguous region). Used in programs and GVLs.

**Syntax.** `{attribute 'subsequent'}`

**Insert location.** Above the variable list / VAR section.

**Gotchas.**
- `VAR_TEMP` in a program with `subsequent` → compile error.
- If any variable is `RETAIN`, **all** variables in the declaration land in retain memory.
- When the list changes, the entire region is re-allocated — addresses shift.

---

### `suppress_warning`

**Purpose.** Suppresses specific compiler warnings.

**Syntax.** `{attribute 'suppress_warning' := '<warning id1>','<warning id2>',...}`

**Insert location.** Line above the POU or DUT declaration.

**Example.** `{attribute 'suppress_warning' := '0125'}` suppresses warning `C0125` within the decorated unit.

---

### `to_string`

**Purpose.** Changes how `TO_STRING(enum_value)` converts an ENUM member: outputs the member name instead of the numeric value.

**Syntax.** `{attribute 'to_string'}`

**Insert location.** First line above the ENUM declaration.

**Example.** With `{attribute 'to_string'}` on `TYPE COLOR : (red := 0, blue := 1, green := 2)`, the call `TO_STRING(COLOR.blue)` returns `'blue'` instead of `'1'`.

---

### `warning disable`, `warning restore`

**Purpose.** Locally disable/re-enable compiler warnings by ID. Note this is a `{warning ...}` pragma, **not** an `{attribute 'warning ...'}` pragma.

**Syntax.**
```
{warning disable <compiler ID>}
{warning restore <compiler ID>}
```

`<compiler ID>` is the `C####` from the warning message. List of warnings: project settings → Compiler warnings category.

**Example.**
```st
VAR
  {warning disable C0195}
  test1 : UINT := -1;          (* no warning *)
  {warning restore C0195}
  test2 : UINT := -1;          (* warns *)
END_VAR
```

## Effects on symbols (overview page)

Source: `_cds_pragma_consequences_to_symbols.html`. Documents which attribute pragmas affect symbol exports (Library Manager, Symbol Configuration, Monitoring). Full table not extracted here — see source page directly when needed.

## Sub-page catalog

Total: 51 pages.

| Sub-page slug | URL fragment |
|---|---|
| Pragmas overview | `_cds_struct_reference_pragmas.html` |
| Message Pragmas | `_cds_pragma_message.html` |
| Attribute pragmas (overview) | `_cds_f_pragmas_attribute.html` |
| Effects on symbols | `_cds_pragma_consequences_to_symbols.html` |
| Custom attribute | `_cds_user_defined_attributes.html` |
| `call_after_global_init_slot` | `_cds_pragma_attribute_call_after_global_init_slot.html` |
| `call_after_init` | `_cds_pragma_attribute_call_after_init.html` |
| `call_after_online_change_slot` | `_cds_pragma_attribute_call_after_online_change_slot.html` |
| `call_before_global_exit_slot` | `_cds_pragma_attribute_call_before_global_exit_slot.html` |
| `call_on_type_change` | `_cds_pragma_attribute_call_on_type_change.html` |
| `conditionalshow` | `_cds_pragma_attribute_conditionalshow.html` |
| `conditionalshow_all_locals` | `_cds_pragma_attribute_conditionalshow_all_locals.html` |
| `const_replaced` / `const_non_replaced` | `_cds_pragma_attribute_const_replaced_non.html` |
| `dataflow` | `_cds_pragma_attribute_dataflow.html` |
| `displaymode` | `_cds_pragma_attribute_displaymode.html` |
| `enable_dynamic_creation` | `_cds_pragma_attribute_enable_dynamic_creation.html` |
| `estimated-stack-usage` | `_cds_pragma_attribute_estimated_stack_usage.html` |
| `ExpandFully` | `_cds_pragma_attribute_expandfully.html` |
| `global_init_slot` | `_cds_pragma_attribute_global_init_slot.html` |
| `hide` | `_cds_pragma_attribute_hide.html` |
| `hide_all_locals` | `_cds_pragma_attribute_hide_all_locals.html` |
| `implicit-parameter` | `_cds_pragma_attribute_implicit-parameter.html` |
| `initialize_on_call` | `_cds_pragma_attribute_initialize_on_call.html` |
| `init_namespace` | `_cds_pragma_attribute_init_namespace.html` |
| `init_on_onlchange` | `_cds_pragma_attribute_init_on_onlchange.html` |
| `instance-path` | `_cds_pragma_attribute_instance_path.html` |
| `io_function_block`, `io_function_block_mapping` | `_cds_pragma_attribute_io_function_block_mapping.html` |
| `is_connected` | `_cds_pragma_attribute_is_connected.html` |
| `linkalways` | `_cds_pragma_attribute_linkalways.html` |
| `monitoring` | `_cds_pragma_attribute_monitoring.html` |
| `monitoring_display` | `_cds_pragma_attribute_monitoring_display.html` |
| `monitoring_encoding` | `_cds_pragma_attribute_monitoring_encoding.html` |
| `no_assign`, `no_assign_warning` | `_cds_pragma_attribute_no_assign.html` |
| `no_check` | `_cds_pragma_attribute_no_check.html` |
| `no_copy` | `_cds_pragma_attribute_no_copy.html` |
| `no-exit` | `_cds_pragma_attribute_no_exit.html` |
| `noinit` | `_cds_pragma_attribute_noinit.html` |
| `no_instance_in_retain` | `_cds_pragma_attribute_no_instance_in_retain.html` |
| `no_virtual_actions` | `_cds_pragma_attribute_no_virtual_actions.html` |
| `obsolete` | `_cds_pragma_attribute_obsolete.html` |
| `pingroup` | `_cds_pragma_attribute_pingroup.html` |
| `pin_presentation_order_inputs`, `pin_presentation_order_outputs` | `_cds_pragma_attribute_pin_presentation_order.html` |
| `pack_mode` | `_cds_pragma_attribute_pack_mode.html` |
| `ProcessValue` | `_cds_pragma_attribute_processvalue.html` |
| `qualified_only` | `_cds_pragma_attribute_qualified_only.html` |
| `reflection` | `_cds_pragma_attribute_reflection.html` |
| `subsequent` | `_cds_pragma_attribute_subsequent.html` |
| `to_string` | `_cds_pragma_attribute_to_string.html` |
| `suppress_warning` | `_cds_pragma_attribute_suppress_warning.html` |
| `warning disable`, `warning restore` | `_cds_pragma_attribute_warning_disable.html` |
| Conditional Pragmas | `_cds_pragma_conditional.html` |
| Region Pragma | `_cds_pragma_region.html` |

## Notes for tooling

**Stage 2 deep-dive into `src/reference/pragmas.ts`** would expose each pragma as a structured record:

```ts
interface Pragma {
  name: string;                    // 'no_init', 'pack_mode', etc.
  aliases?: string[];              // alternate spellings: 'noinit', 'no-init'
  category: 'attribute' | 'message' | 'conditional' | 'region';
  takesValue: boolean;
  insertLocation: 'fb_top' | 'var_above' | 'method_top' | 'pou_top' | 'enum_top' | 'gvl_top' | 'struct_top';
  oneliner: string;                // single-sentence summary for hover
  gotchas?: string[];              // critical pitfalls
  requires?: string[];             // other attributes that must also be present
  forbids?: string[];              // pragmas that conflict
  url: string;                     // CODESYS doc URL
}
```

**Diagnostic candidates (Stage 2):**
- Unknown pragma name in `{attribute '<name>'}` → warning ("not in CODESYS catalog; user-defined attributes should prefix with vendor name")
- Insert-location violation (e.g., `linkalways` not on first line) → warning
- Required companion missing (`instance-path` without `reflection` on FB) → error
- Conflicting pragmas on same symbol (`pin_presentation_order_*` AND `pingroup`) → warning
- `subsequent` with `VAR_TEMP` in a program → error
- `call_after_*` / `call_before_*` POU with `VAR_INPUT` declarations → error

**Hover augmentation (Stage 2):**
- Hovering any pragma name shows: purpose, syntax, insert location, gotchas, link to CODESYS URL
- Hovering `{attribute 'global_init_slot' := '<N>'}` shows what runs at that slot — cross-references [12-global-init-slots.md](./12-global-init-slots.md)
