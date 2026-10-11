/**
 * THE VENDOR-FACT TABLE — every re-measurable vendor fact `DIALECT.md` marks `[PROBE: <id>]`, as ONE row each (openspec
 * `vendor-fact-probe`). `vendor-facts.ts` runs the rows on its own `ide.ps1` instance and diffs what the IDE answers
 * against the committed `vendor-facts.<vendor>.json`. A new vendor question is a new ROW here — never a new probe script.
 *
 * A row is a scenario in a small CLOSED vocabulary that each vendor core implements once (design.md "0.1"):
 *
 *   steps   create · find · setText · rename · move · delete · open · close · build · reload · invoke
 *   reads   member · class · guid · parent · children · signature · parse · xml · same · diagnostics · process · absent
 *
 * Every write names its path, `via: "push"` (one declarative op over the instance's pipe through the SHIPPED bridge —
 * what `volt push` sends; the runner does it) or `via: "script"` (the vendor API: CODESYS scripting, TwinCAT COM; the
 * vendor core does it). There is no default. A step or read may carry `vendor`: the same question asked of a different
 * surface (CODESYS's language model vs TwinCAT's caption) — row DATA, never a branch in a core. Every step's outcome is
 * recorded (`accepted` or `refused: <the vendor's words>`); a read runs after the step whose `tag` its `at` names
 * (`start` = before the first step, `end` = after the last).
 *
 * MEMBER PATHS (`member`, `same`, `class{path}`, `invoke`) are `<root>.<segment>…`:
 *   CODESYS roots   script (the subject's scripting object) · object (its IObject, by the object manager) · meta (its
 *                   IMetaObject) · project (the open project, scripting) · app (its active application) ·
 *                   static:<Full.Type.Name> (a type loaded in the IDE)
 *   TwinCAT roots   item (the subject's tree item) · tree:<path> (LookupTreeItem) · plc (the PLC project item) · root
 *                   (its nested IEC project) · dte · project:<n> (Solution.Projects.Item(n)) · caption (the subject's
 *                   Solution Explorer caption)
 *   segments        Name (a property, by reflection first; a static one on a static: type) · Name() / Name(<json>, …)
 *                   (a call) · [n] (an index) · $type (the CLR type's full name) · $base (CODESYS: below the scripting
 *                   wrapper, `BaseObject` followed down) · $interfaces (the interface names, sorted) · $methods("<prefix>")
 *                   (method names, sorted) · $constructors (of a static: type: each one's parameter types) · $enumNames
 *                   (of an enum type) · $count · $extension (of a path string) · $xmlElements (of an XML string: its
 *                   element names in document order, no attribute values)
 * A member that is not there reads `null` — the absence IS the answer (D35, D37); a vendor exception on the way reads
 * `{ "raised": "<type>: <message>" }`. A value that would not render WHOLE — a collection of more than 500 items, or one
 * nested deeper than two levels — is a probe fault naming it, never a silent cut.
 *
 * Literal shape (Repo.Gates `VendorFactTableMatchesDialectTests` reads this file as TEXT): inside the ROWS export each
 * row opens with `id: "<kebab>"` and holds exactly one `dialect: ["Id", …]`; no computed ids, no spreads, and no other
 * `id:` / `dialect:` anywhere in ROWS. The helpers below sit ABOVE that export for that reason (the gate reads from its first mention on).
 */

export type Vendor = "codesys" | "twincat"
/** `true` = asked; `{ absent }` = the vendor lacks the fact, refused by name and recorded as `"absent: <reason>"`. */
export type Applies = true | { absent: string }
export type Via = "push" | "script"
/** Vendor-neutral object kinds a core creates. A DUT's `seed` is the shape it is CREATED as (CODESYS `DutType`,
 *  TwinCAT tree code 605/606/607/623); a POU's kind is its seed. `task_system` / `task_plc` are TwinCAT's two task
 *  items (C19b). */
export type Kind =
  | "folder"
  | "program"
  | "function_block"
  | "function"
  | "interface"
  | "gvl"
  | "dut"
  | "method"
  | "property"
  | "action"
  | "transition"
  | "task_system"
  | "task_plc"
export type Seed = "struct" | "enum" | "union" | "alias"
/** A literal handed to the vendor: JSON, a vendor enum member by full name, or a callback that calls the named
 *  zero-argument method on the object it is handed (CODESYS's `PerformWithWriteableCopy(Action<T>)`, C19). */
export type Arg = string | number | boolean | null | { enum: string } | { callback: string }

type StepBase = { vendor?: Vendor; tag?: string }
/** A handle a step names: `root` (the PLC project root: CODESYS's active application, TwinCAT's IEC project),
 *  `tree:<path>` (TwinCAT system-manager path), or the `as` of an earlier create/find. */
type Handle = string
export type Step = StepBase &
  (
    | {
        op: "create"
        as: string
        kind: Kind
        name: string
        parent: Handle
        via: "script"
        seed?: Seed
        decl?: string
        impl?: string
      }
    | { op: "create"; as: string; kind: Kind; name: string; parent: Handle; via: "push"; source: string }
    /** An EXISTING object by its exact name, in the open project or below `under`. What no create can make is found,
     *  never synthesized (C2n). */
    | { op: "find"; as: string; name: string; under?: Handle }
    | { op: "setText"; on: Handle; via: "script"; decl?: string; impl?: string; appendImpl?: string }
    | {
        op: "setText"
        on: Handle
        via: "push"
        source?: string
        prepend?: string
        after?: { line: string; add: string }
        restore?: true
      }
    | { op: "rename"; on: Handle; to: string; via: Via }
    /** `to`: a folder handle (into it), another item's handle (into ITS folder), or `home` (where it was found). */
    | { op: "move"; on: Handle; to: Handle; via: Via }
    | { op: "delete"; on: Handle; via: Via }
    /** A fresh COPY of a COMMITTED fixture becomes the open project; the row's cleanup reopens the run's own copy. */
    | { op: "open"; fixture: string }
    | { op: "close" }
    | { op: "build" }
    /** Save, close and reopen the same copy. */
    | { op: "reload" }
    | { op: "invoke"; on?: Handle; path: string; args?: Arg[] }
    | { op: "invoke"; on?: Handle; path: string; set: Arg }
  )

type ReadBase = { key: string; at: string | string[]; on?: Handle | Handle[]; vendor?: Vendor }
export type Read = ReadBase &
  (
    | { op: "member"; path: string }
    | { op: "class"; path?: string }
    | { op: "guid" }
    | { op: "parent" }
    | { op: "children" }
    | { op: "signature" }
    | { op: "parse"; text?: string }
    /** TwinCAT: `ProduceXml` of the subject at an XPath; with `file`, the subject's BACKING FILE instead (the
     *  PLC-side `.TcTTO`, C19b's third copy). */
    | { op: "xml"; xpath: string; file?: true }
    /** Reference identity of the object at `path` NOW with the object an earlier `member` read (`as`, its key) held. */
    | { op: "same"; path: string; as: string }
    /** The build's messages on the row's subjects; with `mentioning`, also any message on another object that mentions
     *  that word (a USER of a changed type: `'DI_10' is no component of 'IQSlices'`), case-insensitive. TwinCAT reads
     *  the bridge's build: `{ success, diagnostics }`, and a diagnostic that names no item is always kept. */
    | { op: "diagnostics"; fields?: ("guid" | "position")[]; mentioning?: string }
    | { op: "process"; what: "exe" | "assembly" | "automation" }
    /** A part of the fact no committed fixture can hold, refused by name. */
    | { op: "absent"; reason: string }
  )

export type Row = {
  id: string
  dialect: string[]
  vendors: { codesys?: Applies; twincat?: Applies }
  steps: Step[]
  reads: Read[]
}

// ── source texts (above ROWS: the gate reads ROWS as text) ──────────────────────────────────────────────────────────

/** A DUT declaration of each shape. `rv`, not `r`: R is an IL operator and a reserved word. */
const DUT = {
  struct: (n: string) => `TYPE ${n} :\nSTRUCT\n\talpha : INT;\n\tbeta : BOOL;\nEND_STRUCT\nEND_TYPE\n`,
  enum: (n: string) => `TYPE ${n} :\n(\n\tRed,\n\tGreen,\n\tBlue\n);\nEND_TYPE\n`,
  union: (n: string) => `TYPE ${n} :\nUNION\n\ti : INT;\n\trv : REAL;\nEND_UNION\nEND_TYPE\n`,
  alias: (n: string) => `TYPE ${n} : STRING(80);\nEND_TYPE\n`,
}
/** Declarations for a scripting write (no implementation). */
const DECL = {
  program: (n: string) => `PROGRAM ${n}\nVAR\nEND_VAR\n`,
  function_block: (n: string) => `FUNCTION_BLOCK ${n}\nVAR\nEND_VAR\n`,
  function: (n: string) => `FUNCTION ${n} : INT\nVAR_INPUT\nEND_VAR\n`,
}
const MARK = "IMPLEMENTATION ST"
/** Whole sources for a push (the wire's item text). */
const SRC = {
  program: (n: string, body = "x := TRUE;", vars = "\tx : BOOL;") =>
    `PROGRAM ${n}\nVAR\n${vars}\nEND_VAR\n${MARK}\n${body}\n\nEND_PROGRAM\n`,
  function_block: (n: string, members = "") =>
    `FUNCTION_BLOCK ${n}\nVAR\n\tx : INT;\nEND_VAR\n${MARK}\nx := x + 1;\n\nEND_FUNCTION_BLOCK\n${members}`,
  function: (n: string, members = "") =>
    `FUNCTION ${n} : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\n${MARK}\n${n} := a + 1;\n\nEND_FUNCTION\n${members}`,
  method: (n: string) => `\nMETHOD ${n} : INT\n${MARK}\n${n} := 1;\nEND_METHOD\n`,
  property: (n: string) => `\nPROPERTY ${n} : INT\nGET\n${MARK}\n\t${n} := 1;\nEND_GET\nEND_PROPERTY\n`,
  action: (n: string) => `\nACTION ${n}\n${MARK}\nx := 1;\nEND_ACTION\n`,
  /** A graphical caller (network text, `packages/volt-cli/docs/network-text.html`). */
  caller: (n: string, lang: "FBD" | "LD", vars: string, net: string) =>
    `PROGRAM ${n}\nVAR\n${vars}\nEND_VAR\nIMPLEMENTATION ${lang}\nNETWORK\n  ${net}\nEND_NETWORK\n\nEND_PROGRAM\n`,
}

/** `kind-source`'s CODESYS subjects (C2g): each DUT shape by its own seed, an enum on Volt's struct seed, PRG/FUN/FB,
 *  text that declares nothing on a DUT and on a POU, an interface and a GVL. */
const CS_KIND_SUBJECTS = [
  "d_struct",
  "d_enum",
  "d_union",
  "d_alias",
  "v_enum",
  "p_prg",
  "p_fun",
  "p_fb",
  "b_dut",
  "b_pou",
  "itf",
  "gvl",
]

// ── the rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const ROWS: Row[] = [
  {
    id: "dut-subtype-in-place",
    dialect: ["C2e"],
    vendors: { codesys: true, twincat: true },
    steps: [
      // A fresh copy: the build half wires a user into the main program.
      { vendor: "codesys", op: "open", fixture: "CodesysTestProject" },
      { op: "create", as: "folder", kind: "folder", name: "VltF_Sub", parent: "root", via: "script" },
      // The bridge path (C2e: "every write a volt push through the bridge unless noted"): a Structure seed, then the
      // other shape's text pushed into it. Each outcome is recorded — the push to union/alias is unmeasured in C2e.
      {
        op: "create",
        as: "p_enum",
        kind: "dut",
        seed: "struct",
        name: "VltF_SubP_enum",
        parent: "folder",
        via: "script",
        decl: DUT.struct("VltF_SubP_enum"),
      },
      {
        op: "create",
        as: "p_union",
        kind: "dut",
        seed: "struct",
        name: "VltF_SubP_union",
        parent: "folder",
        via: "script",
        decl: DUT.struct("VltF_SubP_union"),
      },
      {
        op: "create",
        as: "p_alias",
        kind: "dut",
        seed: "struct",
        name: "VltF_SubP_alias",
        parent: "folder",
        via: "script",
        decl: DUT.struct("VltF_SubP_alias"),
      },
      { tag: "seeded", op: "setText", on: "p_enum", via: "push", source: DUT.enum("VltF_SubP_enum") },
      { op: "setText", on: "p_union", via: "push", source: DUT.union("VltF_SubP_union") },
      { tag: "pushed", op: "setText", on: "p_alias", via: "push", source: DUT.alias("VltF_SubP_alias") },
      // TwinCAT: 623 (alias) and 607 (union) seeds given a STRUCT through the push (C2e "623/607 → struct").
      {
        vendor: "twincat",
        op: "create",
        as: "q_union",
        kind: "dut",
        seed: "union",
        name: "VltF_SubQ_union",
        parent: "folder",
        via: "script",
        decl: DUT.union("VltF_SubQ_union"),
      },
      {
        vendor: "twincat",
        tag: "q_made",
        op: "create",
        as: "q_alias",
        kind: "dut",
        seed: "alias",
        name: "VltF_SubQ_alias",
        parent: "folder",
        via: "script",
        decl: DUT.alias("VltF_SubQ_alias"),
      },
      { vendor: "twincat", op: "setText", on: "q_union", via: "push", source: DUT.struct("VltF_SubQ_union") },
      {
        vendor: "twincat",
        tag: "q_pushed",
        op: "setText",
        on: "q_alias",
        via: "push",
        source: DUT.struct("VltF_SubQ_alias"),
      },
      // The noted exception on CODESYS: the same change through scripting.
      {
        vendor: "codesys",
        op: "create",
        as: "s_enum",
        kind: "dut",
        seed: "struct",
        name: "VltF_SubS_enum",
        parent: "folder",
        via: "script",
        decl: DUT.struct("VltF_SubS_enum"),
      },
      {
        vendor: "codesys",
        op: "create",
        as: "s_union",
        kind: "dut",
        seed: "struct",
        name: "VltF_SubS_union",
        parent: "folder",
        via: "script",
        decl: DUT.struct("VltF_SubS_union"),
      },
      {
        vendor: "codesys",
        op: "create",
        as: "s_alias",
        kind: "dut",
        seed: "struct",
        name: "VltF_SubS_alias",
        parent: "folder",
        via: "script",
        decl: DUT.struct("VltF_SubS_alias"),
      },
      { vendor: "codesys", op: "setText", on: "s_enum", via: "script", decl: DUT.enum("VltF_SubS_enum") },
      { vendor: "codesys", op: "setText", on: "s_union", via: "script", decl: DUT.union("VltF_SubS_union") },
      {
        vendor: "codesys",
        tag: "scripted",
        op: "setText",
        on: "s_alias",
        via: "script",
        decl: DUT.alias("VltF_SubS_alias"),
      },
      // The build: a user of each NEW shape, reached from the main program (CODESYS compiles only what a task reaches).
      {
        op: "create",
        as: "user",
        kind: "program",
        name: "VltF_SubUse",
        parent: "folder",
        via: "push",
        source: SRC.program(
          "VltF_SubUse",
          "e := VltF_SubP_enum.Blue;\nu.i := 1;\na := 'y';",
          "\te : VltF_SubP_enum := VltF_SubP_enum.Green;\n\tu : VltF_SubP_union;\n\ta : VltF_SubP_alias := 'x';",
        ),
      },
      { op: "find", as: "main", name: "PLC_PRG" },
      { vendor: "codesys", op: "setText", on: "main", via: "script", appendImpl: "\nVltF_SubUse();\n" },
      // TwinCAT compiles only what a task reaches too (measured 2026-10-11: uncalled, the negative control built
      // `success: true` with nothing on the user). Through the push, so cleanup restores PLC_PRG's text.
      {
        vendor: "twincat",
        op: "setText",
        on: "main",
        via: "push",
        after: { line: "IMPLEMENTATION ST", add: "VltF_SubUse();" },
      },
      { tag: "built", op: "build" },
      // NEGATIVE CONTROL: "no error" proves nothing if the build never compiled the user.
      {
        op: "setText",
        on: "user",
        via: "push",
        source: SRC.program("VltF_SubUse", "e := VltF_SubP_enum.Purple;\ne.alpha := 1;", "\te : VltF_SubP_enum;"),
      },
      { tag: "negative", op: "build" },
      // CODESYS: the IDE-authored text-list enum (an ITextListEnumerationObject) takes struct / union / alias pushed.
      { vendor: "codesys", op: "open", fixture: "Pro2193" },
      { vendor: "codesys", tag: "pro2193", op: "find", as: "iq", name: "IQSlices" },
      { vendor: "codesys", tag: "iq_struct", op: "setText", on: "iq", via: "push", source: DUT.struct("IQSlices") },
      // Its users now compile as against a struct (`'DI_10' is no component of 'IQSlices'`).
      { vendor: "codesys", tag: "iq_built", op: "build" },
      { vendor: "codesys", tag: "iq_union", op: "setText", on: "iq", via: "push", source: DUT.union("IQSlices") },
      { vendor: "codesys", tag: "iq_alias", op: "setText", on: "iq", via: "push", source: DUT.alias("IQSlices") },
      // TwinCAT: an IDE-authored 605, and each shape CREATED through the push, then a reload (the tree code lags).
      { vendor: "twincat", op: "find", as: "pack", name: "E_PackML_Mode" },
      {
        vendor: "twincat",
        tag: "pack_struct",
        op: "setText",
        on: "pack",
        via: "push",
        source: DUT.struct("E_PackML_Mode"),
      },
      // The 605 holding a struct compiles as one (`'ePRODUCTION' is no component of 'E_PACKML_MODE'`).
      { vendor: "twincat", tag: "pack_built", op: "build" },
      {
        vendor: "twincat",
        tag: "pack_union",
        op: "setText",
        on: "pack",
        via: "push",
        source: DUT.union("E_PackML_Mode"),
      },
      { vendor: "twincat", tag: "pack_restored", op: "setText", on: "pack", via: "push", restore: true },
      {
        vendor: "twincat",
        op: "create",
        as: "c_enum",
        kind: "dut",
        name: "VltF_SubC_enum",
        parent: "folder",
        via: "push",
        source: DUT.enum("VltF_SubC_enum"),
      },
      {
        vendor: "twincat",
        op: "create",
        as: "c_union",
        kind: "dut",
        name: "VltF_SubC_union",
        parent: "folder",
        via: "push",
        source: DUT.union("VltF_SubC_union"),
      },
      {
        vendor: "twincat",
        tag: "created",
        op: "create",
        as: "c_alias",
        kind: "dut",
        name: "VltF_SubC_alias",
        parent: "folder",
        via: "push",
        source: DUT.alias("VltF_SubC_alias"),
      },
      { vendor: "twincat", tag: "reloaded", op: "reload" },
    ],
    reads: [
      { key: "guid", at: ["seeded", "pushed"], on: ["p_enum", "p_union", "p_alias"], op: "guid" },
      { key: "parent", at: "pushed", on: ["p_enum", "p_union", "p_alias"], op: "parent" },
      { vendor: "codesys", key: "class", at: ["seeded", "pushed"], on: ["p_enum", "p_union", "p_alias"], op: "class" },
      { vendor: "codesys", key: "guid", at: "scripted", on: ["s_enum", "s_union", "s_alias"], op: "guid" },
      { vendor: "codesys", key: "class", at: "scripted", on: ["s_enum", "s_union", "s_alias"], op: "class" },
      { vendor: "codesys", key: "parent", at: "scripted", on: ["s_enum", "s_union", "s_alias"], op: "parent" },
      // The tree code lags, and a reload RE-DERIVES it — measured on exactly these: struct seeds changed in place.
      {
        vendor: "twincat",
        key: "item-type",
        at: ["seeded", "pushed", "reloaded"],
        on: ["p_enum", "p_union", "p_alias"],
        op: "member",
        path: "item.ItemType",
      },
      { vendor: "twincat", key: "guid-reloaded", at: "reloaded", on: ["p_enum", "p_union", "p_alias"], op: "guid" },
      // 607 / 623 → struct.
      {
        vendor: "twincat",
        key: "guid",
        at: ["q_made", "q_pushed", "reloaded"],
        on: ["q_union", "q_alias"],
        op: "guid",
      },
      {
        vendor: "twincat",
        key: "item-type",
        at: ["q_made", "q_pushed", "reloaded"],
        on: ["q_union", "q_alias"],
        op: "member",
        path: "item.ItemType",
      },
      { key: "diagnostics", at: ["built", "negative"], op: "diagnostics" },
      { vendor: "codesys", key: "diagnostics-iq", at: "iq_built", op: "diagnostics", mentioning: "IQSlices" },
      { vendor: "twincat", key: "diagnostics-pack", at: "pack_built", op: "diagnostics", mentioning: "E_PackML_Mode" },
      { vendor: "codesys", key: "guid", at: ["pro2193", "iq_struct", "iq_union", "iq_alias"], on: "iq", op: "guid" },
      {
        vendor: "codesys",
        key: "interfaces",
        at: ["pro2193", "iq_struct", "iq_union", "iq_alias"],
        on: "iq",
        op: "member",
        path: "object.$interfaces",
      },
      { vendor: "twincat", key: "guid", at: ["pack_struct", "pack_union", "pack_restored"], on: "pack", op: "guid" },
      {
        vendor: "twincat",
        key: "item-type",
        at: ["pack_struct", "pack_union", "pack_restored"],
        on: "pack",
        op: "member",
        path: "item.ItemType",
      },
      {
        vendor: "twincat",
        key: "item-type",
        at: ["created", "reloaded"],
        on: ["c_enum", "c_union", "c_alias"],
        op: "member",
        path: "item.ItemType",
      },
    ],
  },
  {
    id: "kind-source",
    dialect: ["C2e", "C2g", "C2h"],
    vendors: { codesys: true, twincat: true },
    steps: [
      // A fresh copy: the reload saves it, and the run's own copy must stay as committed.
      { vendor: "codesys", op: "open", fixture: "CodesysTestProject" },
      { op: "create", as: "folder", kind: "folder", name: "VltF_Kind", parent: "root", via: "script" },
      // Each DUT shape created by its own seed (what the IDE's Add-DUT dialog makes), and Volt's Structure seed
      // holding another shape (what a push-create makes).
      {
        op: "create",
        as: "d_struct",
        kind: "dut",
        seed: "struct",
        name: "VltF_K_S",
        parent: "folder",
        via: "script",
        decl: DUT.struct("VltF_K_S"),
      },
      {
        op: "create",
        as: "d_enum",
        kind: "dut",
        seed: "enum",
        name: "VltF_K_E",
        parent: "folder",
        via: "script",
        decl: DUT.enum("VltF_K_E"),
      },
      {
        op: "create",
        as: "d_union",
        kind: "dut",
        seed: "union",
        name: "VltF_K_U",
        parent: "folder",
        via: "script",
        decl: DUT.union("VltF_K_U"),
      },
      {
        op: "create",
        as: "d_alias",
        kind: "dut",
        seed: "alias",
        name: "VltF_K_A",
        parent: "folder",
        via: "script",
        decl: DUT.alias("VltF_K_A"),
      },
      {
        op: "create",
        as: "v_enum",
        kind: "dut",
        seed: "struct",
        name: "VltF_K_VE",
        parent: "folder",
        via: "script",
        decl: DUT.enum("VltF_K_VE"),
      },
      {
        op: "create",
        as: "p_prg",
        kind: "program",
        name: "VltF_K_P",
        parent: "folder",
        via: "script",
        decl: DECL.program("VltF_K_P"),
      },
      {
        op: "create",
        as: "p_fun",
        kind: "function",
        name: "VltF_K_F",
        parent: "folder",
        via: "script",
        decl: DECL.function("VltF_K_F"),
      },
      // CODESYS (C2g): text that declares nothing (an unclosed comment) on a DUT and a POU, an interface and a GVL.
      {
        vendor: "codesys",
        op: "create",
        as: "b_dut",
        kind: "dut",
        seed: "struct",
        name: "VltF_K_BD",
        parent: "folder",
        via: "script",
        decl: "(* doc\n" + DUT.struct("VltF_K_BD"),
      },
      {
        vendor: "codesys",
        op: "create",
        as: "b_pou",
        kind: "program",
        name: "VltF_K_BP",
        parent: "folder",
        via: "script",
        decl: "(* doc\n" + DECL.program("VltF_K_BP"),
      },
      {
        vendor: "codesys",
        op: "create",
        as: "itf",
        kind: "interface",
        name: "VltF_K_I",
        parent: "folder",
        via: "script",
      },
      { vendor: "codesys", op: "create", as: "gvl", kind: "gvl", name: "VltF_K_G", parent: "folder", via: "script" },
      {
        tag: "created",
        op: "create",
        as: "p_fb",
        kind: "function_block",
        name: "VltF_K_FB",
        parent: "folder",
        via: "script",
        decl: DECL.function_block("VltF_K_FB"),
      },
      // In place: a struct becomes an enum, an enum a struct, a program holds FB text.
      { op: "setText", on: "d_struct", via: "script", decl: DUT.enum("VltF_K_S") },
      { op: "setText", on: "d_enum", via: "script", decl: DUT.struct("VltF_K_E") },
      { tag: "changed", op: "setText", on: "p_prg", via: "script", decl: DECL.function_block("VltF_K_P") },
      { tag: "built", op: "build" },
      { tag: "reloaded", op: "reload" },
      // The IDE-authored text-list enum (C2e / C2g control).
      { vendor: "codesys", op: "open", fixture: "Pro2193" },
      { vendor: "codesys", tag: "pro2193", op: "find", as: "iq", name: "IQSlices" },
    ],
    reads: [
      // CODESYS (C2g): the object, its meta object and its icon carry no kind; the language model's SIGNATURE does.
      // The icon is the factory's, one per TypeGuid (`DUTObject.plugin.dll`, reflected): per object, the TypeGuid and the
      // interface set stand for it — a per-object (dynamic) icon would need an interface the set would show.
      // `GetLanguageModel()` is read as its element skeleton (its attributes carry fresh guids): family, no subtype.
      {
        vendor: "codesys",
        key: "script-type",
        at: ["created", "changed"],
        on: CS_KIND_SUBJECTS,
        op: "member",
        path: "script.$type",
      },
      {
        vendor: "codesys",
        key: "class",
        at: ["created", "changed", "reloaded"],
        on: CS_KIND_SUBJECTS,
        op: "class",
      },
      {
        vendor: "codesys",
        key: "type-guid",
        at: ["created", "changed"],
        on: CS_KIND_SUBJECTS,
        op: "member",
        path: "object.TypeGuid",
      },
      {
        vendor: "codesys",
        key: "interfaces",
        at: ["created", "changed"],
        on: CS_KIND_SUBJECTS,
        op: "member",
        path: "object.$interfaces",
      },
      {
        vendor: "codesys",
        key: "meta-object-type",
        at: ["created", "changed"],
        on: CS_KIND_SUBJECTS,
        op: "member",
        path: "meta.ObjectType",
      },
      {
        vendor: "codesys",
        key: "language-model",
        at: ["created", "changed"],
        on: CS_KIND_SUBJECTS,
        op: "member",
        path: "object.GetLanguageModel().$xmlElements",
      },
      {
        vendor: "codesys",
        key: "signature",
        at: ["created", "changed", "built", "reloaded"],
        on: CS_KIND_SUBJECTS,
        op: "signature",
      },
      { vendor: "codesys", key: "class", at: "pro2193", on: "iq", op: "class" },
      { vendor: "codesys", key: "interfaces", at: "pro2193", on: "iq", op: "member", path: "object.$interfaces" },
      { vendor: "codesys", key: "signature", at: "pro2193", on: "iq", op: "signature" },
      // TwinCAT (C2h): no current object property; the tree code lags until a reload; the caption shows the model.
      {
        vendor: "twincat",
        key: "item-type",
        at: ["created", "changed", "built", "reloaded"],
        on: ["d_struct", "d_enum", "d_union", "d_alias", "v_enum", "p_prg", "p_fun", "p_fb"],
        op: "member",
        path: "item.ItemType",
      },
      {
        vendor: "twincat",
        key: "caption",
        at: ["created", "changed", "built", "reloaded"],
        on: ["d_struct", "d_enum", "d_union", "d_alias", "v_enum", "p_prg", "p_fun", "p_fb"],
        op: "member",
        path: "caption",
      },
    ],
  },
  {
    id: "kind-audit",
    dialect: ["C2f", "C2l"],
    vendors: { codesys: true, twincat: true },
    steps: [
      { op: "create", as: "folder", kind: "folder", name: "VltF_Audit", parent: "root", via: "script" },
      {
        op: "create",
        as: "fb",
        kind: "function_block",
        name: "VltF_A_FB",
        parent: "folder",
        via: "script",
        decl: DECL.function_block("VltF_A_FB"),
      },
      { op: "create", as: "m", kind: "method", name: "AM", parent: "fb", via: "script" },
      { op: "create", as: "p", kind: "property", name: "AP", parent: "fb", via: "script" },
      { tag: "created", op: "create", as: "a", kind: "action", name: "AA", parent: "fb", via: "script" },
      // C2f: a POU's text decides its kind on CODESYS; on TwinCAT the tree kind stays (written through the push).
      { vendor: "codesys", tag: "retyped", op: "setText", on: "fb", via: "script", decl: DECL.program("VltF_A_FB") },
      {
        vendor: "twincat",
        tag: "retyped",
        op: "setText",
        on: "fb",
        via: "push",
        source: SRC.program("VltF_A_FB") + SRC.method("AM") + SRC.property("AP") + SRC.action("AA"),
      },
      // C2l: a member keeps its class whatever its text.
      { vendor: "codesys", op: "setText", on: "m", via: "script", decl: "PROPERTY AM : INT\n" },
      { vendor: "codesys", tag: "member-texts", op: "setText", on: "p", via: "script", decl: "METHOD AP : INT\n" },
    ],
    reads: [
      {
        vendor: "codesys",
        key: "class",
        at: ["created", "retyped", "member-texts"],
        on: ["fb", "m", "p", "a"],
        op: "class",
      },
      {
        vendor: "codesys",
        key: "signature",
        at: ["created", "retyped", "member-texts"],
        on: ["fb", "m", "p"],
        op: "signature",
      },
      {
        vendor: "twincat",
        key: "item-type",
        at: ["created", "retyped"],
        on: ["fb", "m", "p", "a"],
        op: "member",
        path: "item.ItemType",
      },
      { key: "children", at: ["created", "retyped"], on: "fb", op: "children" },
    ],
  },
  {
    id: "pou-kind-signature",
    dialect: ["C2j"],
    vendors: { codesys: true },
    steps: [
      { op: "create", as: "folder", kind: "folder", name: "VltF_Sig", parent: "root", via: "script" },
      {
        op: "create",
        as: "prg",
        kind: "program",
        name: "VltF_Sig_P",
        parent: "folder",
        via: "script",
        decl: DECL.program("VltF_Sig_P"),
      },
      {
        op: "create",
        as: "fb",
        kind: "function_block",
        name: "VltF_Sig_FB",
        parent: "folder",
        via: "script",
        decl: DECL.function_block("VltF_Sig_FB"),
      },
      {
        op: "create",
        as: "fun",
        kind: "function",
        name: "VltF_Sig_F",
        parent: "folder",
        via: "script",
        decl: DECL.function("VltF_Sig_F"),
      },
      {
        op: "create",
        as: "excluded",
        kind: "function_block",
        name: "VltF_Sig_X",
        parent: "folder",
        via: "script",
        decl: DECL.function_block("VltF_Sig_X"),
      },
      { tag: "created", op: "invoke", on: "excluded", path: "script.build_properties.exclude_from_build", set: true },
      { tag: "built", op: "build" },
    ],
    reads: [
      { key: "signature", at: ["created", "built"], on: ["prg", "fb", "fun", "excluded"], op: "signature" },
      { key: "parse", at: "built", on: ["prg", "fb", "fun", "excluded"], op: "parse" },
      { key: "parse-unclosed-comment", at: "start", op: "parse", text: "(* doc\nPROGRAM P\nVAR\nEND_VAR\n" },
      { key: "parse-empty", at: "start", op: "parse", text: "" },
      { key: "parse-prose", at: "start", op: "parse", text: "this is not a declaration\n" },
    ],
  },
  {
    id: "pou-members-follow-text",
    dialect: ["C2k"],
    vendors: { codesys: true, twincat: true },
    steps: [
      { op: "create", as: "folder", kind: "folder", name: "VltF_Mem", parent: "root", via: "script" },
      // CODESYS: an FB seed given FUNCTION text, then each member asked for through scripting.
      {
        vendor: "codesys",
        op: "create",
        as: "pou",
        kind: "function_block",
        name: "VltF_Mem_FB",
        parent: "folder",
        via: "script",
        decl: DECL.function_block("VltF_Mem_FB"),
      },
      {
        vendor: "codesys",
        tag: "as-function",
        op: "setText",
        on: "pou",
        via: "script",
        decl: DECL.function("VltF_Mem_FB"),
      },
      { vendor: "codesys", op: "create", as: "m", kind: "method", name: "MM", parent: "pou", via: "script" },
      { vendor: "codesys", op: "create", as: "p", kind: "property", name: "MP", parent: "pou", via: "script" },
      { vendor: "codesys", op: "create", as: "a", kind: "action", name: "MA", parent: "pou", via: "script" },
      {
        vendor: "codesys",
        tag: "members-asked",
        op: "create",
        as: "t",
        kind: "transition",
        name: "MT",
        parent: "pou",
        via: "script",
      },
      {
        vendor: "codesys",
        tag: "back",
        op: "setText",
        on: "pou",
        via: "script",
        decl: DECL.function_block("VltF_Mem_FB"),
      },
      { vendor: "codesys", op: "create", as: "m2", kind: "method", name: "MM2", parent: "pou", via: "script" },
      // CODESYS, the other half: an FB HOLDING method KM, then given FUNCTION text — KM is kept, the next is refused.
      {
        vendor: "codesys",
        op: "create",
        as: "kfb",
        kind: "function_block",
        name: "VltF_Mem_KFB",
        parent: "folder",
        via: "script",
        decl: DECL.function_block("VltF_Mem_KFB"),
      },
      {
        vendor: "codesys",
        tag: "km-made",
        op: "create",
        as: "km",
        kind: "method",
        name: "KM",
        parent: "kfb",
        via: "script",
      },
      {
        vendor: "codesys",
        tag: "km-function",
        op: "setText",
        on: "kfb",
        via: "script",
        decl: DECL.function("VltF_Mem_KFB"),
      },
      {
        vendor: "codesys",
        tag: "second-member",
        op: "create",
        as: "km2",
        kind: "method",
        name: "KM2",
        parent: "kfb",
        via: "script",
      },
      // TwinCAT: through the shipped push, a FUNCTION carrying each member (C2k's TwinCAT half), read after EACH push —
      // a push replaces the member set, so one read at the end would show only the last.
      {
        vendor: "twincat",
        op: "create",
        as: "pou",
        kind: "function",
        name: "VltF_Mem_F",
        parent: "folder",
        via: "push",
        source: SRC.function("VltF_Mem_F"),
      },
      {
        vendor: "twincat",
        tag: "with-method",
        op: "setText",
        on: "pou",
        via: "push",
        source: SRC.function("VltF_Mem_F", SRC.method("MM")),
      },
      {
        vendor: "twincat",
        tag: "with-property",
        op: "setText",
        on: "pou",
        via: "push",
        source: SRC.function("VltF_Mem_F", SRC.property("MP")),
      },
      {
        vendor: "twincat",
        tag: "back",
        op: "setText",
        on: "pou",
        via: "push",
        source: SRC.function("VltF_Mem_F", SRC.action("MA")),
      },
      // A CREATE of FUNCTION text + METHOD is rolled back whole: nothing of it in the folder.
      {
        vendor: "twincat",
        tag: "function-with-method-created",
        op: "create",
        as: "fm",
        kind: "function",
        name: "VltF_Mem_FM",
        parent: "folder",
        via: "push",
        source: SRC.function("VltF_Mem_FM", SRC.method("FM1")),
      },
      // An FB HOLDING method KM, rewritten to FUNCTION text: KM is kept, and a second method is refused.
      {
        vendor: "twincat",
        tag: "km-made",
        op: "create",
        as: "kfb",
        kind: "function_block",
        name: "VltF_Mem_KFB",
        parent: "folder",
        via: "push",
        source: SRC.function_block("VltF_Mem_KFB", SRC.method("KM")),
      },
      {
        vendor: "twincat",
        tag: "km-function",
        op: "setText",
        on: "kfb",
        via: "push",
        source: SRC.function("VltF_Mem_KFB", SRC.method("KM")),
      },
      {
        vendor: "twincat",
        tag: "second-member",
        op: "setText",
        on: "kfb",
        via: "push",
        source: SRC.function("VltF_Mem_KFB", SRC.method("KM") + SRC.method("KM2")),
      },
    ],
    reads: [
      { vendor: "codesys", key: "children", at: ["members-asked", "back"], on: "pou", op: "children" },
      { vendor: "twincat", key: "children", at: ["with-method", "with-property", "back"], on: "pou", op: "children" },
      {
        vendor: "twincat",
        key: "folder-after-create",
        at: "function-with-method-created",
        on: "folder",
        op: "children",
      },
      { key: "kfb-children", at: ["km-made", "km-function", "second-member"], on: "kfb", op: "children" },
      { vendor: "codesys", key: "kfb-signature", at: ["km-made", "km-function"], on: "kfb", op: "signature" },
    ],
  },
  {
    id: "graphical-callee-seed",
    dialect: ["C2m"],
    vendors: { twincat: true },
    steps: [
      { op: "create", as: "folder", kind: "folder", name: "VltF_Seed", parent: "root", via: "script" },
      // Each callee created in this session under the one POU seed (604), then a graphical call of it.
      {
        op: "create",
        as: "fun",
        kind: "function",
        name: "VltF_Seed_F",
        parent: "folder",
        via: "push",
        source: SRC.function("VltF_Seed_F"),
      },
      {
        op: "create",
        as: "fun_noeno",
        kind: "program",
        name: "VltF_Seed_FC",
        parent: "folder",
        via: "push",
        source: SRC.caller("VltF_Seed_FC", "FBD", "\tn : INT;\n\tr : INT;", "r := VltF_Seed_F(n);"),
      },
      {
        op: "create",
        as: "fun_eno",
        kind: "program",
        name: "VltF_Seed_FE",
        parent: "folder",
        via: "push",
        source: SRC.caller(
          "VltF_Seed_FE",
          "FBD",
          "\tgo : BOOL;\n\tn : INT;\n\tok : BOOL;",
          "ok := VltF_Seed_F(EN := go, n).ENO;",
        ),
      },
      {
        op: "create",
        as: "prg",
        kind: "program",
        name: "VltF_Seed_P",
        parent: "folder",
        via: "push",
        source: SRC.program("VltF_Seed_P"),
      },
      {
        op: "create",
        as: "prg_eno",
        kind: "program",
        name: "VltF_Seed_PE",
        parent: "folder",
        via: "push",
        source: SRC.caller("VltF_Seed_PE", "LD", "\tgo : BOOL;\n\tdone : BOOL;", "done := VltF_Seed_P(EN := go).ENO;"),
      },
      {
        op: "create",
        as: "fb",
        kind: "function_block",
        name: "VltF_Seed_B",
        parent: "folder",
        via: "push",
        source: SRC.function_block("VltF_Seed_B"),
      },
      {
        op: "create",
        as: "fb_eno",
        kind: "program",
        name: "VltF_Seed_BE",
        parent: "folder",
        via: "push",
        source: SRC.caller(
          "VltF_Seed_BE",
          "LD",
          "\tgo : BOOL;\n\tdone : BOOL;\n\tb : VltF_Seed_B;",
          "done := b(EN := go).ENO;",
        ),
      },
      { tag: "built", op: "build" },
    ],
    reads: [{ key: "diagnostics", at: "built", op: "diagnostics" }],
  },
  {
    id: "merged-classes",
    dialect: ["C2n"],
    vendors: { codesys: true },
    steps: [
      { op: "open", fixture: "Pro2193" },
      { op: "find", as: "check", name: "CheckBounds" },
      { op: "find", as: "persistent", name: "PersistentVars" },
      { op: "find", as: "textlist", name: "IQSlices" },
      { op: "find", as: "basefb", name: "VisionSystem_BaseFB" },
      { tag: "found", op: "find", as: "abstract", name: "TakePicture", under: "basefb" },
      // Update in place, rename, rename back + move, move home + original text — all through the shipped push.
      { op: "setText", on: "check", via: "push", prepend: "// volt vendor-facts: written in place\n" },
      { op: "setText", on: "persistent", via: "push", prepend: "// volt vendor-facts: written in place\n" },
      { op: "setText", on: "textlist", via: "push", prepend: "// volt vendor-facts: written in place\n" },
      {
        tag: "updated",
        op: "setText",
        on: "basefb",
        via: "push",
        after: {
          line: "METHOD ABSTRACT TakePicture : enumResultTakePicture",
          add: "// volt vendor-facts: written in place",
        },
      },
      { op: "rename", on: "check", to: "VltR_CheckBounds", via: "push" },
      { op: "rename", on: "persistent", to: "VltR_PersistentVars", via: "push" },
      { tag: "renamed", op: "rename", on: "textlist", to: "VltR_IQSlices", via: "push" },
      { op: "rename", on: "check", to: "CheckBounds", via: "push" },
      { op: "rename", on: "persistent", to: "PersistentVars", via: "push" },
      { op: "rename", on: "textlist", to: "IQSlices", via: "push" },
      { op: "move", on: "check", to: "basefb", via: "push" },
      { op: "move", on: "persistent", to: "basefb", via: "push" },
      { tag: "moved", op: "move", on: "textlist", to: "basefb", via: "push" },
      { op: "move", on: "check", to: "home", via: "push" },
      { op: "move", on: "persistent", to: "home", via: "push" },
      { op: "move", on: "textlist", to: "home", via: "push" },
      { op: "setText", on: "check", via: "push", restore: true },
      { op: "setText", on: "persistent", via: "push", restore: true },
      { op: "setText", on: "textlist", via: "push", restore: true },
      { tag: "restored", op: "setText", on: "basefb", via: "push", restore: true },
    ],
    reads: [
      {
        key: "guid",
        at: ["found", "updated", "renamed", "moved", "restored"],
        on: ["check", "persistent", "textlist", "abstract"],
        op: "guid",
      },
      {
        key: "class",
        at: ["found", "updated", "renamed", "moved", "restored"],
        on: ["check", "persistent", "textlist", "abstract"],
        op: "class",
      },
      { key: "check-kind", at: ["found", "restored"], on: "check", op: "member", path: "object.KindOfCheckFunction" },
      {
        key: "nvl",
        at: "start",
        op: "absent",
        reason:
          "no committed fixture holds an NVL (CAN_TO_PLC is in Bakon Nano), and the scripting container has no create_nvl",
      },
    ],
  },
  {
    id: "folder-name-collision",
    dialect: ["D34"],
    vendors: { twincat: true },
    steps: [
      // Folder first, then an object of that name at the same level: refused.
      { op: "create", as: "f1", kind: "folder", name: "VltF_Collide1", parent: "root", via: "script" },
      {
        tag: "folder-first",
        op: "create",
        as: "o1",
        kind: "program",
        name: "VltF_Collide1",
        parent: "root",
        via: "script",
        decl: DECL.program("VltF_Collide1"),
      },
      // Object first, then a folder of that name: the two may coexist (an ORDER constraint).
      {
        op: "create",
        as: "o2",
        kind: "program",
        name: "VltF_Collide2",
        parent: "root",
        via: "script",
        decl: DECL.program("VltF_Collide2"),
      },
      {
        tag: "object-first",
        op: "create",
        as: "f2",
        kind: "folder",
        name: "VltF_Collide2",
        parent: "root",
        via: "script",
      },
    ],
    reads: [],
  },
  {
    id: "empty-folder-survives",
    dialect: ["C29"],
    vendors: { codesys: true, twincat: true },
    steps: [
      { op: "create", as: "folder", kind: "folder", name: "VltF_Empty", parent: "root", via: "script" },
      {
        op: "create",
        as: "pou",
        kind: "program",
        name: "VltF_Empty_P",
        parent: "folder",
        via: "script",
        decl: DECL.program("VltF_Empty_P"),
      },
      { tag: "emptied", op: "delete", on: "pou", via: "script" },
      { tag: "removed", op: "delete", on: "folder", via: "script" },
    ],
    reads: [{ key: "children", at: "emptied", on: "folder", op: "children" }],
  },
  {
    id: "task-config-survives-delete",
    dialect: ["C22"],
    vendors: { codesys: true },
    steps: [
      { op: "open", fixture: "CodesysTestProject" },
      { op: "find", as: "config", name: "Task Configuration" },
      { tag: "found", op: "find", as: "task", name: "MainTask" },
      { tag: "deleted", op: "delete", on: "task", via: "script" },
    ],
    reads: [
      { key: "children", at: ["found", "deleted"], on: "config", op: "children" },
      { key: "class", at: ["found", "deleted"], on: "config", op: "class" },
    ],
  },
  {
    id: "task-writable",
    dialect: ["C19"],
    vendors: { codesys: true },
    steps: [
      { op: "open", fixture: "CodesysTestProject" },
      { tag: "found", op: "find", as: "task", name: "MainTask" },
      { tag: "interval", op: "invoke", on: "task", path: "script.interval", set: "t#20ms" },
      { tag: "interval-unit", op: "invoke", on: "task", path: "script.interval_unit", set: "ms" },
      { tag: "priority-int", op: "invoke", on: "task", path: "script.priority", set: 5 },
      { tag: "priority-string", op: "invoke", on: "task", path: "script.priority", set: "5" },
      { tag: "watchdog-enabled", op: "invoke", on: "task", path: "script.watchdog.enabled", set: true },
      { tag: "watchdog-time", op: "invoke", on: "task", path: "script.watchdog.time", set: "100" },
      { tag: "watchdog-sensitivity", op: "invoke", on: "task", path: "script.watchdog.sensitivity", set: "2" },
    ],
    reads: [
      { key: "interval", at: ["found", "interval"], on: "task", op: "member", path: "script.interval" },
      { key: "interval-unit", at: ["found", "interval-unit"], on: "task", op: "member", path: "script.interval_unit" },
      {
        key: "priority",
        at: ["found", "priority-int", "priority-string"],
        on: "task",
        op: "member",
        path: "script.priority",
      },
      {
        key: "watchdog-enabled",
        at: ["found", "watchdog-enabled"],
        on: "task",
        op: "member",
        path: "script.watchdog.enabled",
      },
      { key: "watchdog-time", at: ["found", "watchdog-time"], on: "task", op: "member", path: "script.watchdog.time" },
      {
        key: "watchdog-sensitivity",
        at: ["found", "watchdog-sensitivity"],
        on: "task",
        op: "member",
        path: "script.watchdog.sensitivity",
      },
    ],
  },
  {
    id: "task-calllist",
    dialect: ["C19"],
    vendors: { codesys: true },
    steps: [
      { op: "open", fixture: "CodesysTestProject" },
      { tag: "found", op: "find", as: "task", name: "MainTask" },
      { tag: "remove-by-name", op: "invoke", on: "task", path: "script.pous.remove", args: ["PLC_PRG"] },
      { tag: "remove-by-index", op: "invoke", on: "task", path: "script.pous.remove", args: [0] },
      { tag: "add", op: "invoke", on: "task", path: "script.pous.add", args: ["PLC_PRG", ""] },
      // The vendor's door: the callback is handed the RAW writeable list.
      {
        tag: "writeable-copy",
        op: "invoke",
        on: "task",
        path: "script.pous.PerformWithWriteableCopy",
        args: [{ callback: "Clear" }],
      },
    ],
    reads: [
      {
        key: "pous",
        at: ["found", "remove-by-name", "remove-by-index", "add", "writeable-copy"],
        on: "task",
        op: "member",
        path: "script.pous",
      },
      { key: "pous-type", at: "found", on: "task", op: "member", path: "script.pous.$type" },
    ],
  },
  {
    id: "task-callcomment",
    dialect: ["C23"],
    vendors: { codesys: true },
    steps: [{ tag: "found", op: "find", as: "task", name: "MainTask" }],
    reads: [
      { key: "entry-type", at: "found", on: "task", op: "member", path: "script.pous.PouObjectList[0].$type" },
      {
        key: "serializable-value-names",
        at: "found",
        on: "task",
        op: "member",
        path: "script.pous.PouObjectList[0].SerializableValueNames",
      },
    ],
  },
  {
    id: "task-kind",
    dialect: ["C30"],
    vendors: { codesys: true },
    steps: [
      { op: "open", fixture: "CodesysTestProject" },
      { tag: "found", op: "find", as: "task", name: "MainTask" },
      { tag: "string", op: "invoke", on: "task", path: "script.kind_of_task", set: "Freewheeling" },
      { tag: "int-1", op: "invoke", on: "task", path: "script.kind_of_task", set: 1 },
      { tag: "int-0", op: "invoke", on: "task", path: "script.kind_of_task", set: 0 },
      {
        tag: "enum",
        op: "invoke",
        on: "task",
        path: "script.kind_of_task",
        set: { enum: "_3S.CoDeSys.TaskConfig.KindOfTask.Freewheeling" },
      },
    ],
    reads: [
      {
        key: "kind",
        at: ["found", "string", "int-1", "int-0", "enum"],
        on: "task",
        op: "member",
        path: "script.kind_of_task",
      },
      { key: "kind-type", at: "found", on: "task", op: "member", path: "script.kind_of_task.$type" },
      { key: "kind-names", at: "found", op: "member", path: "static:_3S.CoDeSys.TaskConfig.KindOfTask.$enumNames" },
    ],
  },
  {
    id: "task-create",
    dialect: ["C31"],
    vendors: { codesys: true },
    steps: [
      { op: "open", fixture: "CodesysTestProject" },
      { op: "find", as: "config", name: "Task Configuration" },
      { tag: "created", op: "invoke", on: "config", path: "script.create_task", args: ["VltF_Task"] },
      { op: "find", as: "task", name: "VltF_Task" },
      { tag: "removed", op: "delete", on: "task", via: "script" },
    ],
    reads: [
      { key: "children", at: ["created", "removed"], on: "config", op: "children" },
      { key: "config-script-type", at: "created", on: "config", op: "member", path: "script.$type" },
    ],
  },
  {
    id: "tc-task-items",
    dialect: ["C19b"],
    vendors: { twincat: true },
    steps: [
      // The PLC half alone: the vendor's own refusal names the order.
      {
        tag: "plc-alone",
        op: "create",
        as: "lone",
        kind: "task_plc",
        name: "VltF_TaskLone",
        parent: "root",
        via: "script",
      },
      { op: "create", as: "sys", kind: "task_system", name: "VltF_Task", parent: "tree:TIRT", via: "script" },
      { tag: "created", op: "create", as: "plc", kind: "task_plc", name: "VltF_Task", parent: "root", via: "script" },
      {
        tag: "cycle",
        op: "invoke",
        on: "sys",
        path: "item.ConsumeXml",
        args: ["<TreeItem><TaskDef><CycleTime>100000</CycleTime></TaskDef></TreeItem>"],
      },
      // THE TRAP: the PLC-side `.TcTTO` holds the same schedule in a third unit (µs). It is a file, written on save.
      { tag: "saved", op: "invoke", path: "dte.ExecuteCommand", args: ["File.SaveAll"] },
      // A priority the fixture's own PlcTask holds: not refused, not taken (C19b ii). The fixture's task is also the
      // three-unit control: one schedule, its system item's two copies and its committed PLC-side `PlcTask.TcTTO`.
      { op: "find", as: "fixture-task", name: "PlcTask", under: "tree:TIRT" },
      { op: "find", as: "fixture-plc-task", name: "PlcTask", under: "root" },
      {
        tag: "taken-priority",
        op: "invoke",
        on: "sys",
        path: "item.ConsumeXml",
        args: ["<TreeItem><TaskDef><Priority>20</Priority></TaskDef></TreeItem>"],
      },
    ],
    reads: [
      { key: "item-type", at: "created", on: ["sys", "plc"], op: "member", path: "item.ItemType" },
      { key: "linked-task", at: "created", on: "plc", op: "xml", xpath: "/TreeItem/PlcTaskDef/LinkedTask" },
      { key: "children", at: "created", on: "plc", op: "children" },
      { key: "cycle-100ns", at: "cycle", on: "sys", op: "xml", xpath: "/TreeItem/TaskDef/CycleTime" },
      { key: "cycle-context-ns", at: "cycle", on: "sys", op: "xml", xpath: "//TcModuleInstance//Context//CycleTime" },
      { key: "tto-cycle-us", at: "saved", on: "plc", op: "xml", file: true, xpath: "/TcPlcObject/Task/CycleTime" },
      {
        key: "fixture-cycle-100ns",
        at: "taken-priority",
        on: "fixture-task",
        op: "xml",
        xpath: "/TreeItem/TaskDef/CycleTime",
      },
      {
        key: "fixture-cycle-context-ns",
        at: "taken-priority",
        on: "fixture-task",
        op: "xml",
        xpath: "//TcModuleInstance//Context//CycleTime",
      },
      {
        key: "fixture-tto-cycle-us",
        at: "taken-priority",
        on: "fixture-plc-task",
        op: "xml",
        file: true,
        xpath: "/TcPlcObject/Task/CycleTime",
      },
      {
        key: "fixture-priority",
        at: "taken-priority",
        on: "fixture-task",
        op: "xml",
        xpath: "/TreeItem/TaskDef/Priority",
      },
      { key: "priority", at: ["cycle", "taken-priority"], on: "sys", op: "xml", xpath: "/TreeItem/TaskDef/Priority" },
    ],
  },
  {
    id: "accessor-decl",
    dialect: ["C32"],
    vendors: { codesys: true },
    steps: [
      {
        op: "create",
        as: "fb",
        kind: "function_block",
        name: "VltF_Acc",
        parent: "root",
        via: "script",
        decl: DECL.function_block("VltF_Acc"),
      },
      { tag: "created", op: "create", as: "prop", kind: "property", name: "P", parent: "fb", via: "script" },
      { op: "find", as: "get", name: "Get", under: "prop" },
      { tag: "accessors", op: "find", as: "set", name: "Set", under: "prop" },
    ],
    reads: [
      { key: "property-declaration", at: "created", on: "prop", op: "member", path: "script.textual_declaration.text" },
      {
        key: "accessor-declaration",
        at: "accessors",
        on: ["get", "set"],
        op: "member",
        path: "script.textual_declaration.text",
      },
      { key: "accessor-parent", at: "accessors", on: ["get", "set"], op: "parent" },
    ],
  },
  {
    id: "project-container",
    dialect: ["C17"],
    vendors: { codesys: true },
    steps: [],
    reads: [
      { key: "project", at: "start", op: "member", path: "project.$base.$type" },
      { key: "project-interfaces", at: "start", op: "member", path: "project.$base.$interfaces" },
      { key: "application", at: "start", op: "member", path: "app.$base.$type" },
      { key: "project-creates", at: "start", op: "member", path: 'project.$methods("create_")' },
      {
        key: "root-container",
        at: "start",
        op: "member",
        path: "static:_3S.CoDeSys.ScriptDriverProjects.ScriptIecLanguageObjectContainerRoot.$constructors",
      },
      {
        key: "node-container",
        at: "start",
        op: "member",
        path: "static:_3S.CoDeSys.ScriptDriverProjects.ScriptIecLanguageObjectContainerObject.$constructors",
      },
    ],
  },
  {
    id: "tc-project-object",
    dialect: ["D35"],
    vendors: { twincat: true },
    steps: [],
    reads: [
      { key: "kind", at: "start", op: "member", path: "project:1.Kind" },
      { key: "full-name-ext", at: "start", op: "member", path: "project:1.FullName.$extension" },
      { key: "object-system-manager", at: "start", op: "member", path: "project:1.Object.SystemManager" },
      { key: "object-unknown-member", at: "start", op: "member", path: "project:1.Object.VoltNotAMember" },
      {
        key: "object-lookup-bogus",
        at: "start",
        op: "member",
        path: 'project:1.Object.LookupTreeItem("VOLT^PROBE^NO^SUCH^PATH")',
      },
    ],
  },
  {
    id: "projectsettings-scope",
    dialect: ["C24"],
    vendors: { codesys: true },
    steps: [
      { tag: "pro2193", op: "open", fixture: "Pro2193" },
      { tag: "closed", op: "close" },
      { tag: "fixture", op: "open", fixture: "CodesysTestProject" },
      { tag: "pro2193-again", op: "open", fixture: "Pro2193" },
    ],
    reads: [
      {
        key: "service",
        at: ["pro2193", "closed", "fixture", "pro2193-again"],
        op: "member",
        path: "static:_3S.CoDeSys.Engine.APEnvironment.LMServiceProvider.ConfigurationService",
      },
      {
        key: "same-service",
        at: ["closed", "fixture", "pro2193-again"],
        op: "same",
        path: "static:_3S.CoDeSys.Engine.APEnvironment.LMServiceProvider.ConfigurationService",
        as: "service",
      },
      {
        key: "disabled-warnings",
        at: ["pro2193", "closed", "fixture", "pro2193-again"],
        op: "member",
        path: "static:_3S.CoDeSys.Engine.APEnvironment.LMServiceProvider.ConfigurationService.WarningConfiguration.GetDisabledWarningIds()",
      },
      {
        key: "utf8",
        at: ["pro2193", "closed", "fixture", "pro2193-again"],
        op: "member",
        path: "static:_3S.CoDeSys.Engine.APEnvironment.LMServiceProvider.ConfigurationService.CompileOptions.UTF8Encoding",
      },
    ],
  },
  {
    id: "compile-options",
    dialect: ["D38"],
    vendors: { codesys: true, twincat: true },
    steps: [],
    reads: [
      {
        vendor: "codesys",
        key: "replace-constants",
        at: "start",
        op: "member",
        path: "static:_3S.CoDeSys.Engine.APEnvironment.LMServiceProvider.ConfigurationService.CompileOptions.ReplaceConstants",
      },
      {
        vendor: "codesys",
        key: "max-warnings",
        at: "start",
        op: "member",
        path: "static:_3S.CoDeSys.Engine.APEnvironment.LMServiceProvider.ConfigurationService.CompileOptions.MaxCompilerWarnings",
      },
      {
        vendor: "codesys",
        key: "defines",
        at: "start",
        op: "member",
        path: "static:_3S.CoDeSys.Engine.APEnvironment.LMServiceProvider.ConfigurationService.CompileOptions.CompilerDefines",
      },
      {
        vendor: "twincat",
        key: "replace-constants",
        at: "start",
        op: "xml",
        on: "root",
        xpath: "/TreeItem/IECProjectDef/CompilerSettings/ReplaceConstants",
      },
      {
        vendor: "twincat",
        key: "max-warnings",
        at: "start",
        op: "xml",
        on: "root",
        xpath: "/TreeItem/IECProjectDef/CompilerSettings/MaxWarnings",
      },
      {
        vendor: "twincat",
        key: "defines",
        at: "start",
        op: "xml",
        on: "root",
        xpath: "/TreeItem/IECProjectDef/CompilerSettings/CompilerDefines",
      },
    ],
  },
  {
    id: "tc-project-settings",
    dialect: ["D37", "D39"],
    vendors: { twincat: true },
    steps: [],
    reads: [
      // The disabled-warning list has no automation surface: the ABSENCE is the fact (D37).
      {
        key: "compiler-settings-children",
        at: "start",
        op: "xml",
        on: "root",
        xpath: "/TreeItem/IECProjectDef/CompilerSettings/*",
      },
      { key: "warning-list", at: "start", op: "xml", on: "root", xpath: "//DisabledWarnings" },
      { key: "warning-as-error", at: "start", op: "xml", on: "root", xpath: "//WarningsAsErrors" },
    ],
  },
  {
    id: "ide-identity",
    dialect: ["V1", "V4", "V5"],
    vendors: { codesys: true, twincat: true },
    steps: [],
    reads: [
      { key: "exe", at: "start", op: "process", what: "exe" },
      { vendor: "codesys", key: "platform", at: "start", op: "process", what: "assembly" },
      { vendor: "twincat", key: "automation", at: "start", op: "process", what: "automation" },
    ],
  },
  {
    id: "diagnostic-child-guid",
    dialect: ["C27"],
    vendors: { codesys: true },
    steps: [
      { op: "open", fixture: "CodesysTestProject" },
      {
        op: "create",
        as: "fb",
        kind: "function_block",
        name: "VltF_Dcn",
        parent: "root",
        via: "script",
        decl: "FUNCTION_BLOCK VltF_Dcn\nVAR\n\tx : INT;\nEND_VAR\n",
        impl: "x := x + 1;\n",
      },
      {
        op: "create",
        as: "m",
        kind: "method",
        name: "MBroken",
        parent: "fb",
        via: "script",
        decl: "METHOD MBroken : INT\n",
        impl: "MBroken := undefinedName;\n",
      },
      {
        op: "create",
        as: "user",
        kind: "program",
        name: "VltF_DcnUse",
        parent: "root",
        via: "script",
        decl: "PROGRAM VltF_DcnUse\nVAR\n\tf : VltF_Dcn;\n\ti : INT;\nEND_VAR\n",
        impl: "f();\ni := f.MBroken();\n",
      },
      { op: "find", as: "main", name: "PLC_PRG" },
      { op: "setText", on: "main", via: "script", appendImpl: "\nVltF_DcnUse();\n" },
      { tag: "built", op: "build" },
    ],
    reads: [
      { key: "guid", at: "built", on: ["fb", "m"], op: "guid" },
      { key: "diagnostics", at: "built", op: "diagnostics", fields: ["guid", "position"] },
    ],
  },
  {
    id: "duplicate-method",
    dialect: ["C33"],
    vendors: { codesys: true },
    steps: [
      {
        op: "create",
        as: "fb",
        kind: "function_block",
        name: "VltF_Dup",
        parent: "root",
        via: "script",
        decl: DECL.function_block("VltF_Dup"),
      },
      { tag: "first", op: "create", as: "m1", kind: "method", name: "Compute", parent: "fb", via: "script" },
      { tag: "second", op: "create", as: "m2", kind: "method", name: "Compute", parent: "fb", via: "script" },
    ],
    reads: [{ key: "children", at: "second", on: "fb", op: "children" }],
  },
]
