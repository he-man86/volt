/**
 * Backend — Rust. IR → Rust text + source map. A printer; every semantic decision was made in lowering.
 *
 * ─── THE EMITTED SURFACE ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * A user's test harness reaches into the generated crate BY NAME — `let mut p = PLC_PRG::new(); p.scan(); p.my_val`
 * is the whole integration. So some of what this prints is a CONTRACT a harness may rely on, and the rest is
 * internal. Saying which is which is the point of this block: a name that moves silently breaks code Volt never sees.
 *
 * **CONTRACT — these do not change without a deliberate, noted decision:**
 *   - the POU struct, named as the POU is in ST (`PLC_PRG`, `FB_Conveyor`);
 *   - `::new()` — a fresh instance at its declared initial values;
 *   - `.scan()` — one cycle of the POU's body, taking `&mut Globals` / `&mut Programs` when the program has them;
 *   - `.init()` — the init-slot pass, when the program has one;
 *   - `Globals` and `Programs`, and their fields;
 *   - every FIELD of a POU or DUT struct: `snake_case` of the ST name, with a trailing `_` when that is a Rust
 *     keyword (`loop` → `loop_`). This is a pure function of the ST name, so an unrelated edit elsewhere in the POU
 *     cannot move it. Two ST names that snake alike would be ambiguous here and are REFUSED rather than numbered —
 *     numbering them by frame position meant declaring a new variable ahead of an existing one renamed the EXISTING
 *     one's field. Measured: zero of the 784 POUs the fixtures build ever collide.
 *
 * **INTERNAL — generated, and free to change:**
 *   - every `fn` a METHOD, ACTION, PROPERTY accessor or FUNCTION becomes, and its deduped name (`routineFnNames`);
 *   - a routine's parameters and locals, which may be renumbered and may collide with the `g` / `prg` parameters;
 *   - every temporary the printer introduces — `__mod_l`, `__bit_v`, `__iter_N`, `__sel_c`, `__c`, `_chain_value_N`,
 *     `_property_N`;
 *   - the prelude types (`IecStr`, `IecString`, `IecWString`) and their methods;
 *   - statement order, parenthesisation, and every cast the printer adds to satisfy rustc.
 *
 * The SOURCE MAP is contract in shape — `{ line, span, uri? }`, where `uri` is absent for the main source and names
 * the file otherwise (an FB declared in a GVL). Which lines carry a mapping is not contract.
 */
export * from "./emit.js"
