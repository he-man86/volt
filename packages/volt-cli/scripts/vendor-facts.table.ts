/**
 * THE VENDOR-FACT TABLE — every re-measurable vendor fact `DIALECT.md` marks `[PROBE: <id>]`, as ONE row each (openspec
 * `vendor-fact-probe`). `vendor-facts.ts` runs the rows on its own `ide.ps1` instance and diffs what the IDE answers
 * against the committed `vendor-facts.<vendor>.json`. A new vendor question is a new ROW here — never a new probe script.
 *
 * A row is a scenario in a small CLOSED vocabulary that each vendor core implements once (design.md "0.1"):
 *
 *   steps   create · find · setText · rename · move · delete · open · close · build · reload · invoke · tryNames
 *   reads   member · class · guid · parent · children · signature · parse · xml · same · diagnostics · process · absent
 *           · tried
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
        /** The body's language (CODESYS `ImplementationLanguages`, TwinCAT's vInfo); ST when not named. */
        language?: "ST" | "FBD" | "LD"
        decl?: string
        impl?: string
      }
    | { op: "create"; as: string; kind: Kind; name: string; parent: Handle; via: "push"; source: string }
    /** An EXISTING object by its exact name, in the open project or below `under`. What no create can make is found,
     *  never synthesized (C2n). */
    | { op: "find"; as: string; name: string; under?: Handle }
    /** `implFrom`: the implementation text another handle holds NOW, verbatim (a graphical body's archive, N24). */
    | {
        op: "setText"
        on: Handle
        via: "script"
        decl?: string
        impl?: string
        appendImpl?: string
        implFrom?: Handle
      }
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
    /** Each name, one at a time: a create of `kind` under `parent` through the vendor API, the name read back, the object
     *  removed again. A refusal is the name's verdict, never the step's: the step answers `accepted` once every name has
     *  been asked, and a `tried` read right after it holds the verdicts. Script-only — a push meets the driver's own
     *  `RefusedName` pre-flight, which answers from the list under test (design 4). At most 500 names, each once
     *  (case-insensitively: both IDEs refuse a name case-insensitively, push-keeps-what-landed 3.1). */
    | { op: "tryNames"; kind: Kind; parent: Handle; names: string[]; via: "script" }
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
    /** `culture`: the IDE process's UI culture (`CurrentUICulture.Name`) — refusal texts are verbatim in that language,
     *  so a run on another locale names it beside the texts that changed. */
    | { op: "process"; what: "exe" | "assembly" | "automation" | "culture" }
    /** A part of the fact no committed fixture can hold, refused by name. */
    | { op: "absent"; reason: string }
    /** The verdicts of the `tryNames` step it follows. `verdicts`: `{ accepted, refused, other, unexplained }` — the
     *  names created under exactly that name, the names the IDE refused AS A NAME (its own name-refusal sentence for that
     *  name: CODESYS "The name 'X' is not valid for this object.", TwinCAT "Creating the child named 'X' is not possible
     *  on node (Name mismatch)"), `"<asked> -> <got>"` for one created under another name, and `"<asked>: <the vendor's
     *  words>"` for any other refusal (a kind refusal, a COM fault, a busy IDE — no verdict on the name), each sorted;
     *  `outcomes`: per name `created`, `created as <got>` or `refused: <the vendor's words>`. */
    | { op: "tried"; what: "verdicts" | "outcomes" }
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

// ── the fold-ins' data (design 4; above ROWS: the gate reads ROWS as text) ──────────────────────────────────────────

const words = (text: string) => text.split(/\s+/).filter(Boolean)

/** `refused-names`' candidates, FROZEN: every word `probe-member-name-refusal.ts` asked as a METHOD in its three runs
 *  (2026-10-03: 274 + 1201 + 421 asks; deleted, `git show 5312b799fe:packages/volt-cli/scripts/probe-member-name-refusal.ts`),
 *  once per word case-insensitively (both IDEs refuse case-insensitively, measured) in the spelling first asked, and
 *  grouped so no group passes the cores' 500-item render limit. The probe GENERATED them (the LSP vocabulary, the
 *  families walk, the verify gaps); the table keeps what it asked, so a new vendor build is asked exactly the words the
 *  drivers' lists were measured on. */
const METHOD_CANDIDATES: Record<string, string[]> = {
  vocabulary: words(`
    FUNCTION_BLOCK END_FUNCTION_BLOCK PROGRAM END_PROGRAM FUNCTION END_FUNCTION METHOD END_METHOD ACTION END_ACTION
    PROPERTY END_PROPERTY END_GET END_SET INTERFACE END_INTERFACE TYPE END_TYPE STRUCT END_STRUCT UNION END_UNION
    VAR VAR_INPUT VAR_OUTPUT VAR_IN_OUT VAR_TEMP VAR_STAT VAR_INST VAR_EXTERNAL VAR_GLOBAL VAR_CONFIG VAR_ACCESS
    END_VAR CONSTANT RETAIN PERSISTENT PUBLIC PRIVATE PROTECTED INTERNAL FINAL ABSTRACT OVERRIDE READ_ONLY
    READ_WRITE EXTENDS IMPLEMENTS ARRAY OF REFERENCE POINTER TO AT STRING WSTRING IF THEN ELSIF ELSE END_IF CASE
    END_CASE FOR BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT RETURN EXIT CONTINUE JMP AND AND_THEN OR
    OR_ELSE NOT XOR MOD DIV TRUE FALSE ADD SUB MUL SHL SHR ROL ROR SEL MUX MIN MAX LIMIT GT LT GE LE EQ NE ABS SQRT
    LN LOG EXP EXPT SIN COS TAN ASIN ACOS ATAN ADR BITADR MOVE INDEXOF SIZEOF XSIZEOF TRUNC TRUNC_INT INI CAL __NEW
    __DELETE __ISVALIDREF __QUERYINTERFACE __QUERYPOINTER __TRY __CATCH __FINALLY __ENDTRY __VARINFO __CURRENTTASK
    __POSITION __POUNAME __COMPARE_AND_SWAP __XADD __POOL TEST_AND_SET __VECTOR VAR_GENERIC PARAMS GET SET THIS
    SUPER FROM NAMESPACE END_NAMESPACE R S LD LDN ST STN RET RETC RETCN JMPC JMPCN CALCN ANDN ORN XORN BOOL BIT BYTE
    WORD DWORD LWORD SINT INT DINT LINT USINT UINT UDINT ULINT REAL LREAL TIME LTIME DATE TOD DT LDATE LTOD LDT
    TIME_OF_DAY DATE_AND_TIME LDATE_AND_TIME LTIME_OF_DAY __XINT __UXINT __XWORD LEN LEFT RIGHT MID CONCAT INSERT
    DELETE REPLACE FIND TON TOF TP CTU CTD CTUD R_TRIG F_TRIG SR RS RTC INT_TO_REAL REAL_TO_INT TO_INT TO_REAL
    BOOL_TO_INT TRUNC_DINT NOW ANY ANY_INT ANY_NUM ANY_REAL PVOID XINT UXINT XWORD N CALC FB_init FB_exit FB_reinit
    __SYSTEM USING WITH NON_RETAIN IMPLEMENTATION Foo Logger LogMsg Log2 Logx MyLog Sine Minimum DoIt Run Execute
    Init Reset Start Stop Get_ Set_ Value Name Count Main Update Error Status
  `),
  families: words(`
    TO_BOOL TO_BIT TO_BYTE TO_WORD TO_DWORD TO_LWORD TO_SINT TO_DINT TO_LINT TO_USINT TO_UINT TO_UDINT TO_ULINT
    TO_LREAL TO_TIME TO_LTIME TO_DATE TO_TOD TO_DT TO_LDATE TO_LTOD TO_LDT TO_STRING TO_WSTRING TO_TIME_OF_DAY
    TO_DATE_AND_TIME TO_LDATE_AND_TIME TO_LTIME_OF_DAY TO___XINT TO___UXINT TO___XWORD TRUNC_BOOL TRUNC_BIT
    TRUNC_BYTE TRUNC_WORD TRUNC_DWORD TRUNC_LWORD TRUNC_SINT TRUNC_LINT TRUNC_USINT TRUNC_UINT TRUNC_UDINT
    TRUNC_ULINT TRUNC_REAL TRUNC_LREAL TRUNC_TIME TRUNC_LTIME TRUNC_DATE TRUNC_TOD TRUNC_DT TRUNC_LDATE TRUNC_LTOD
    TRUNC_LDT TRUNC_STRING TRUNC_WSTRING TRUNC_TIME_OF_DAY TRUNC_DATE_AND_TIME TRUNC_LDATE_AND_TIME
    TRUNC_LTIME_OF_DAY TRUNC___XINT TRUNC___UXINT TRUNC___XWORD ANY_BIT ANY_STRING ANY_DATE ANY_ELEMENTARY
    ANY_DERIVED ANY_MAGNITUDE ANY_SIGNED ANY_UNSIGNED ANY_DURATION ANY_CHAR ANY_CHARS ANY_INTEGER ANY_FLOAT ANY_TYPE
    ANY_POINTER ANY_FOO CHAR WCHAR UCHAR UTF8 __Foo a__b _Foo Foo_ EN ENO NIL NULL LABEL CONFIGURATION
    END_CONFIGURATION RESOURCE END_RESOURCE TASK STEP END_STEP INITIAL_STEP TRANSITION END_TRANSITION ON PRIORITY
    SINGLE INTERVAL OVERLAP ROUND FLOOR CEIL SIGN ATAN2 LAZY __LAZY UNION_ BOOL_ INT2 TO_ TO_FOO DINT_TO TRUNC_
    TRUNC_FOO __ISVALIDREF_ __SYSTEM_ __NEW_ __CURRENTTASK2 __PROPERTYINFO __ADR __BITADR __UNREACHABLE
    __ISVALIDINTERFACE __TYPEOF __TYPECLASS __INSTANCE __MAXPOS
  `),
  "conversions-1": words(`
    BOOL_TO_BIT BOOL_TO_BYTE BOOL_TO_WORD BOOL_TO_DWORD BOOL_TO_LWORD BOOL_TO_SINT BOOL_TO_DINT BOOL_TO_LINT
    BOOL_TO_USINT BOOL_TO_UINT BOOL_TO_UDINT BOOL_TO_ULINT BOOL_TO_REAL BOOL_TO_LREAL BOOL_TO_TIME BOOL_TO_LTIME
    BOOL_TO_DATE BOOL_TO_TOD BOOL_TO_DT BOOL_TO_LDATE BOOL_TO_LTOD BOOL_TO_LDT BOOL_TO_STRING BOOL_TO_WSTRING
    BOOL_TO_TIME_OF_DAY BOOL_TO_DATE_AND_TIME BOOL_TO_LDATE_AND_TIME BOOL_TO_LTIME_OF_DAY BOOL_TO___XINT
    BOOL_TO___UXINT BOOL_TO___XWORD BOOL_TO_BOOL BIT_TO_BOOL BIT_TO_BYTE BIT_TO_WORD BIT_TO_DWORD BIT_TO_LWORD
    BIT_TO_SINT BIT_TO_INT BIT_TO_DINT BIT_TO_LINT BIT_TO_USINT BIT_TO_UINT BIT_TO_UDINT BIT_TO_ULINT BIT_TO_REAL
    BIT_TO_LREAL BIT_TO_TIME BIT_TO_LTIME BIT_TO_DATE BIT_TO_TOD BIT_TO_DT BIT_TO_LDATE BIT_TO_LTOD BIT_TO_LDT
    BIT_TO_STRING BIT_TO_WSTRING BIT_TO_TIME_OF_DAY BIT_TO_DATE_AND_TIME BIT_TO_LDATE_AND_TIME BIT_TO_LTIME_OF_DAY
    BIT_TO___XINT BIT_TO___UXINT BIT_TO___XWORD BIT_TO_BIT BYTE_TO_BOOL BYTE_TO_BIT BYTE_TO_WORD BYTE_TO_DWORD
    BYTE_TO_LWORD BYTE_TO_SINT BYTE_TO_INT BYTE_TO_DINT BYTE_TO_LINT BYTE_TO_USINT BYTE_TO_UINT BYTE_TO_UDINT
    BYTE_TO_ULINT BYTE_TO_REAL BYTE_TO_LREAL BYTE_TO_TIME BYTE_TO_LTIME BYTE_TO_DATE BYTE_TO_TOD BYTE_TO_DT
    BYTE_TO_LDATE BYTE_TO_LTOD BYTE_TO_LDT BYTE_TO_STRING BYTE_TO_WSTRING BYTE_TO_TIME_OF_DAY BYTE_TO_DATE_AND_TIME
    BYTE_TO_LDATE_AND_TIME BYTE_TO_LTIME_OF_DAY BYTE_TO___XINT BYTE_TO___UXINT BYTE_TO___XWORD BYTE_TO_BYTE
    WORD_TO_BOOL WORD_TO_BIT WORD_TO_BYTE WORD_TO_DWORD WORD_TO_LWORD WORD_TO_SINT WORD_TO_INT WORD_TO_DINT
    WORD_TO_LINT WORD_TO_USINT WORD_TO_UINT WORD_TO_UDINT WORD_TO_ULINT WORD_TO_REAL WORD_TO_LREAL WORD_TO_TIME
    WORD_TO_LTIME WORD_TO_DATE WORD_TO_TOD WORD_TO_DT WORD_TO_LDATE WORD_TO_LTOD WORD_TO_LDT WORD_TO_STRING
    WORD_TO_WSTRING WORD_TO_TIME_OF_DAY WORD_TO_DATE_AND_TIME WORD_TO_LDATE_AND_TIME WORD_TO_LTIME_OF_DAY
    WORD_TO___XINT WORD_TO___UXINT WORD_TO___XWORD WORD_TO_WORD DWORD_TO_BOOL DWORD_TO_BIT DWORD_TO_BYTE
    DWORD_TO_WORD DWORD_TO_LWORD DWORD_TO_SINT DWORD_TO_INT DWORD_TO_DINT DWORD_TO_LINT DWORD_TO_USINT DWORD_TO_UINT
    DWORD_TO_UDINT DWORD_TO_ULINT DWORD_TO_REAL DWORD_TO_LREAL DWORD_TO_TIME DWORD_TO_LTIME DWORD_TO_DATE
    DWORD_TO_TOD DWORD_TO_DT DWORD_TO_LDATE DWORD_TO_LTOD DWORD_TO_LDT DWORD_TO_STRING DWORD_TO_WSTRING
    DWORD_TO_TIME_OF_DAY DWORD_TO_DATE_AND_TIME DWORD_TO_LDATE_AND_TIME DWORD_TO_LTIME_OF_DAY DWORD_TO___XINT
    DWORD_TO___UXINT DWORD_TO___XWORD DWORD_TO_BCD DWORD_TO_DWORD LWORD_TO_BOOL LWORD_TO_BIT LWORD_TO_BYTE
    LWORD_TO_WORD LWORD_TO_DWORD LWORD_TO_SINT LWORD_TO_INT LWORD_TO_DINT LWORD_TO_LINT LWORD_TO_USINT LWORD_TO_UINT
    LWORD_TO_UDINT LWORD_TO_ULINT LWORD_TO_REAL LWORD_TO_LREAL LWORD_TO_TIME LWORD_TO_LTIME LWORD_TO_DATE
    LWORD_TO_TOD LWORD_TO_DT LWORD_TO_LDATE LWORD_TO_LTOD LWORD_TO_LDT LWORD_TO_STRING LWORD_TO_WSTRING
    LWORD_TO_TIME_OF_DAY LWORD_TO_DATE_AND_TIME LWORD_TO_LDATE_AND_TIME LWORD_TO_LTIME_OF_DAY LWORD_TO___XINT
    LWORD_TO___UXINT LWORD_TO___XWORD LWORD_TO_LWORD SINT_TO_BOOL SINT_TO_BIT SINT_TO_BYTE SINT_TO_WORD
    SINT_TO_DWORD SINT_TO_LWORD SINT_TO_INT SINT_TO_DINT SINT_TO_LINT SINT_TO_USINT SINT_TO_UINT SINT_TO_UDINT
    SINT_TO_ULINT SINT_TO_REAL SINT_TO_LREAL SINT_TO_TIME SINT_TO_LTIME SINT_TO_DATE SINT_TO_TOD SINT_TO_DT
    SINT_TO_LDATE SINT_TO_LTOD SINT_TO_LDT SINT_TO_STRING SINT_TO_WSTRING SINT_TO_TIME_OF_DAY SINT_TO_DATE_AND_TIME
    SINT_TO_LDATE_AND_TIME SINT_TO_LTIME_OF_DAY SINT_TO___XINT SINT_TO___UXINT SINT_TO___XWORD SINT_TO_SINT
    INT_TO_BOOL INT_TO_BIT INT_TO_BYTE INT_TO_WORD INT_TO_DWORD INT_TO_LWORD INT_TO_SINT INT_TO_DINT INT_TO_LINT
    INT_TO_USINT INT_TO_UINT INT_TO_UDINT INT_TO_ULINT INT_TO_LREAL INT_TO_TIME INT_TO_LTIME INT_TO_DATE INT_TO_TOD
    INT_TO_DT INT_TO_LDATE INT_TO_LTOD INT_TO_LDT INT_TO_STRING INT_TO_WSTRING INT_TO_TIME_OF_DAY
    INT_TO_DATE_AND_TIME INT_TO_LDATE_AND_TIME INT_TO_LTIME_OF_DAY INT_TO___XINT INT_TO___UXINT INT_TO___XWORD
    INT_TO_FOO INT_TO_BCD INT_TO_INT DINT_TO_BOOL DINT_TO_BIT DINT_TO_BYTE DINT_TO_WORD DINT_TO_DWORD DINT_TO_LWORD
    DINT_TO_SINT DINT_TO_INT DINT_TO_LINT DINT_TO_USINT DINT_TO_UINT DINT_TO_UDINT DINT_TO_ULINT DINT_TO_REAL
    DINT_TO_LREAL DINT_TO_TIME DINT_TO_LTIME DINT_TO_DATE DINT_TO_TOD DINT_TO_DT DINT_TO_LDATE DINT_TO_LTOD
    DINT_TO_LDT DINT_TO_STRING DINT_TO_WSTRING DINT_TO_TIME_OF_DAY DINT_TO_DATE_AND_TIME DINT_TO_LDATE_AND_TIME
    DINT_TO_LTIME_OF_DAY DINT_TO___XINT DINT_TO___UXINT DINT_TO___XWORD DINT_TO_DINT LINT_TO_BOOL LINT_TO_BIT
    LINT_TO_BYTE LINT_TO_WORD LINT_TO_DWORD LINT_TO_LWORD LINT_TO_SINT LINT_TO_INT LINT_TO_DINT LINT_TO_USINT
    LINT_TO_UINT LINT_TO_UDINT LINT_TO_ULINT LINT_TO_REAL LINT_TO_LREAL LINT_TO_TIME LINT_TO_LTIME LINT_TO_DATE
    LINT_TO_TOD LINT_TO_DT LINT_TO_LDATE LINT_TO_LTOD LINT_TO_LDT LINT_TO_STRING LINT_TO_WSTRING LINT_TO_TIME_OF_DAY
    LINT_TO_DATE_AND_TIME LINT_TO_LDATE_AND_TIME LINT_TO_LTIME_OF_DAY LINT_TO___XINT LINT_TO___UXINT LINT_TO___XWORD
    LINT_TO_LINT USINT_TO_BOOL USINT_TO_BIT USINT_TO_BYTE USINT_TO_WORD USINT_TO_DWORD USINT_TO_LWORD USINT_TO_SINT
    USINT_TO_INT USINT_TO_DINT USINT_TO_LINT USINT_TO_UINT USINT_TO_UDINT USINT_TO_ULINT USINT_TO_REAL
    USINT_TO_LREAL USINT_TO_TIME USINT_TO_LTIME USINT_TO_DATE USINT_TO_TOD USINT_TO_DT USINT_TO_LDATE USINT_TO_LTOD
    USINT_TO_LDT USINT_TO_STRING USINT_TO_WSTRING USINT_TO_TIME_OF_DAY USINT_TO_DATE_AND_TIME
    USINT_TO_LDATE_AND_TIME USINT_TO_LTIME_OF_DAY USINT_TO___XINT USINT_TO___UXINT USINT_TO___XWORD USINT_TO_USINT
    UINT_TO_BOOL UINT_TO_BIT UINT_TO_BYTE UINT_TO_WORD UINT_TO_DWORD UINT_TO_LWORD UINT_TO_SINT UINT_TO_INT
    UINT_TO_DINT UINT_TO_LINT UINT_TO_USINT UINT_TO_UDINT UINT_TO_ULINT UINT_TO_REAL UINT_TO_LREAL UINT_TO_TIME
    UINT_TO_LTIME UINT_TO_DATE UINT_TO_TOD UINT_TO_DT UINT_TO_LDATE UINT_TO_LTOD UINT_TO_LDT UINT_TO_STRING
    UINT_TO_WSTRING UINT_TO_TIME_OF_DAY UINT_TO_DATE_AND_TIME UINT_TO_LDATE_AND_TIME UINT_TO_LTIME_OF_DAY
    UINT_TO___XINT UINT_TO___UXINT UINT_TO___XWORD UINT_TO_UINT
  `),
  "conversions-2": words(`
    UDINT_TO_BOOL UDINT_TO_BIT UDINT_TO_BYTE UDINT_TO_WORD UDINT_TO_DWORD UDINT_TO_LWORD UDINT_TO_SINT UDINT_TO_INT
    UDINT_TO_DINT UDINT_TO_LINT UDINT_TO_USINT UDINT_TO_UINT UDINT_TO_ULINT UDINT_TO_REAL UDINT_TO_LREAL
    UDINT_TO_TIME UDINT_TO_LTIME UDINT_TO_DATE UDINT_TO_TOD UDINT_TO_DT UDINT_TO_LDATE UDINT_TO_LTOD UDINT_TO_LDT
    UDINT_TO_STRING UDINT_TO_WSTRING UDINT_TO_TIME_OF_DAY UDINT_TO_DATE_AND_TIME UDINT_TO_LDATE_AND_TIME
    UDINT_TO_LTIME_OF_DAY UDINT_TO___XINT UDINT_TO___UXINT UDINT_TO___XWORD UDINT_TO_UDINT ULINT_TO_BOOL
    ULINT_TO_BIT ULINT_TO_BYTE ULINT_TO_WORD ULINT_TO_DWORD ULINT_TO_LWORD ULINT_TO_SINT ULINT_TO_INT ULINT_TO_DINT
    ULINT_TO_LINT ULINT_TO_USINT ULINT_TO_UINT ULINT_TO_UDINT ULINT_TO_REAL ULINT_TO_LREAL ULINT_TO_TIME
    ULINT_TO_LTIME ULINT_TO_DATE ULINT_TO_TOD ULINT_TO_DT ULINT_TO_LDATE ULINT_TO_LTOD ULINT_TO_LDT ULINT_TO_STRING
    ULINT_TO_WSTRING ULINT_TO_TIME_OF_DAY ULINT_TO_DATE_AND_TIME ULINT_TO_LDATE_AND_TIME ULINT_TO_LTIME_OF_DAY
    ULINT_TO___XINT ULINT_TO___UXINT ULINT_TO___XWORD ULINT_TO_ULINT REAL_TO_BOOL REAL_TO_BIT REAL_TO_BYTE
    REAL_TO_WORD REAL_TO_DWORD REAL_TO_LWORD REAL_TO_SINT REAL_TO_DINT REAL_TO_LINT REAL_TO_USINT REAL_TO_UINT
    REAL_TO_UDINT REAL_TO_ULINT REAL_TO_LREAL REAL_TO_TIME REAL_TO_LTIME REAL_TO_DATE REAL_TO_TOD REAL_TO_DT
    REAL_TO_LDATE REAL_TO_LTOD REAL_TO_LDT REAL_TO_STRING REAL_TO_WSTRING REAL_TO_TIME_OF_DAY REAL_TO_DATE_AND_TIME
    REAL_TO_LDATE_AND_TIME REAL_TO_LTIME_OF_DAY REAL_TO___XINT REAL_TO___UXINT REAL_TO___XWORD REAL_TO_REAL
    LREAL_TO_BOOL LREAL_TO_BIT LREAL_TO_BYTE LREAL_TO_WORD LREAL_TO_DWORD LREAL_TO_LWORD LREAL_TO_SINT LREAL_TO_INT
    LREAL_TO_DINT LREAL_TO_LINT LREAL_TO_USINT LREAL_TO_UINT LREAL_TO_UDINT LREAL_TO_ULINT LREAL_TO_REAL
    LREAL_TO_TIME LREAL_TO_LTIME LREAL_TO_DATE LREAL_TO_TOD LREAL_TO_DT LREAL_TO_LDATE LREAL_TO_LTOD LREAL_TO_LDT
    LREAL_TO_STRING LREAL_TO_WSTRING LREAL_TO_TIME_OF_DAY LREAL_TO_DATE_AND_TIME LREAL_TO_LDATE_AND_TIME
    LREAL_TO_LTIME_OF_DAY LREAL_TO___XINT LREAL_TO___UXINT LREAL_TO___XWORD LREAL_TO_LREAL TIME_TO_BOOL TIME_TO_BIT
    TIME_TO_BYTE TIME_TO_WORD TIME_TO_DWORD TIME_TO_LWORD TIME_TO_SINT TIME_TO_INT TIME_TO_DINT TIME_TO_LINT
    TIME_TO_USINT TIME_TO_UINT TIME_TO_UDINT TIME_TO_ULINT TIME_TO_REAL TIME_TO_LREAL TIME_TO_LTIME TIME_TO_DATE
    TIME_TO_TOD TIME_TO_DT TIME_TO_LDATE TIME_TO_LTOD TIME_TO_LDT TIME_TO_STRING TIME_TO_WSTRING TIME_TO_TIME_OF_DAY
    TIME_TO_DATE_AND_TIME TIME_TO_LDATE_AND_TIME TIME_TO_LTIME_OF_DAY TIME_TO___XINT TIME_TO___UXINT TIME_TO___XWORD
    TIME_TO_TIME LTIME_TO_BOOL LTIME_TO_BIT LTIME_TO_BYTE LTIME_TO_WORD LTIME_TO_DWORD LTIME_TO_LWORD LTIME_TO_SINT
    LTIME_TO_INT LTIME_TO_DINT LTIME_TO_LINT LTIME_TO_USINT LTIME_TO_UINT LTIME_TO_UDINT LTIME_TO_ULINT
    LTIME_TO_REAL LTIME_TO_LREAL LTIME_TO_TIME LTIME_TO_DATE LTIME_TO_TOD LTIME_TO_DT LTIME_TO_LDATE LTIME_TO_LTOD
    LTIME_TO_LDT LTIME_TO_STRING LTIME_TO_WSTRING LTIME_TO_TIME_OF_DAY LTIME_TO_DATE_AND_TIME
    LTIME_TO_LDATE_AND_TIME LTIME_TO_LTIME_OF_DAY LTIME_TO___XINT LTIME_TO___UXINT LTIME_TO___XWORD LTIME_TO_LTIME
    DATE_TO_BOOL DATE_TO_BIT DATE_TO_BYTE DATE_TO_WORD DATE_TO_DWORD DATE_TO_LWORD DATE_TO_SINT DATE_TO_INT
    DATE_TO_DINT DATE_TO_LINT DATE_TO_USINT DATE_TO_UINT DATE_TO_UDINT DATE_TO_ULINT DATE_TO_REAL DATE_TO_LREAL
    DATE_TO_TIME DATE_TO_LTIME DATE_TO_TOD DATE_TO_DT DATE_TO_LDATE DATE_TO_LTOD DATE_TO_LDT DATE_TO_STRING
    DATE_TO_WSTRING DATE_TO_TIME_OF_DAY DATE_TO_DATE_AND_TIME DATE_TO_LDATE_AND_TIME DATE_TO_LTIME_OF_DAY
    DATE_TO___XINT DATE_TO___UXINT DATE_TO___XWORD DATE_TO_DATE TOD_TO_BOOL TOD_TO_BIT TOD_TO_BYTE TOD_TO_WORD
    TOD_TO_DWORD TOD_TO_LWORD TOD_TO_SINT TOD_TO_INT TOD_TO_DINT TOD_TO_LINT TOD_TO_USINT TOD_TO_UINT TOD_TO_UDINT
    TOD_TO_ULINT TOD_TO_REAL TOD_TO_LREAL TOD_TO_TIME TOD_TO_LTIME TOD_TO_DATE TOD_TO_DT TOD_TO_LDATE TOD_TO_LTOD
    TOD_TO_LDT TOD_TO_STRING TOD_TO_WSTRING TOD_TO_TIME_OF_DAY TOD_TO_DATE_AND_TIME TOD_TO_LDATE_AND_TIME
    TOD_TO_LTIME_OF_DAY TOD_TO___XINT TOD_TO___UXINT TOD_TO___XWORD TOD_TO_TOD DT_TO_BOOL DT_TO_BIT DT_TO_BYTE
    DT_TO_WORD DT_TO_DWORD DT_TO_LWORD DT_TO_SINT DT_TO_INT DT_TO_DINT DT_TO_LINT DT_TO_USINT DT_TO_UINT DT_TO_UDINT
    DT_TO_ULINT DT_TO_REAL DT_TO_LREAL DT_TO_TIME DT_TO_LTIME DT_TO_DATE DT_TO_TOD DT_TO_LDATE DT_TO_LTOD DT_TO_LDT
    DT_TO_STRING DT_TO_WSTRING DT_TO_TIME_OF_DAY DT_TO_DATE_AND_TIME DT_TO_LDATE_AND_TIME DT_TO_LTIME_OF_DAY
    DT_TO___XINT DT_TO___UXINT DT_TO___XWORD DT_TO_DT LDATE_TO_BOOL LDATE_TO_BIT LDATE_TO_BYTE LDATE_TO_WORD
    LDATE_TO_DWORD LDATE_TO_LWORD LDATE_TO_SINT LDATE_TO_INT LDATE_TO_DINT LDATE_TO_LINT LDATE_TO_USINT
    LDATE_TO_UINT LDATE_TO_UDINT LDATE_TO_ULINT LDATE_TO_REAL LDATE_TO_LREAL LDATE_TO_TIME LDATE_TO_LTIME
    LDATE_TO_DATE LDATE_TO_TOD LDATE_TO_DT LDATE_TO_LTOD LDATE_TO_LDT LDATE_TO_STRING LDATE_TO_WSTRING
    LDATE_TO_TIME_OF_DAY LDATE_TO_DATE_AND_TIME LDATE_TO_LDATE_AND_TIME LDATE_TO_LTIME_OF_DAY LDATE_TO___XINT
    LDATE_TO___UXINT LDATE_TO___XWORD LDATE_TO_LDATE LTOD_TO_BOOL LTOD_TO_BIT LTOD_TO_BYTE LTOD_TO_WORD
    LTOD_TO_DWORD LTOD_TO_LWORD LTOD_TO_SINT LTOD_TO_INT LTOD_TO_DINT LTOD_TO_LINT LTOD_TO_USINT LTOD_TO_UINT
    LTOD_TO_UDINT LTOD_TO_ULINT LTOD_TO_REAL LTOD_TO_LREAL LTOD_TO_TIME LTOD_TO_LTIME LTOD_TO_DATE LTOD_TO_TOD
    LTOD_TO_DT LTOD_TO_LDATE LTOD_TO_LDT LTOD_TO_STRING LTOD_TO_WSTRING LTOD_TO_TIME_OF_DAY LTOD_TO_DATE_AND_TIME
    LTOD_TO_LDATE_AND_TIME LTOD_TO_LTIME_OF_DAY LTOD_TO___XINT LTOD_TO___UXINT LTOD_TO___XWORD LTOD_TO_LTOD
    LDT_TO_BOOL LDT_TO_BIT LDT_TO_BYTE LDT_TO_WORD LDT_TO_DWORD LDT_TO_LWORD LDT_TO_SINT LDT_TO_INT LDT_TO_DINT
    LDT_TO_LINT LDT_TO_USINT LDT_TO_UINT LDT_TO_UDINT LDT_TO_ULINT LDT_TO_REAL LDT_TO_LREAL LDT_TO_TIME LDT_TO_LTIME
    LDT_TO_DATE LDT_TO_TOD LDT_TO_DT LDT_TO_LDATE LDT_TO_LTOD LDT_TO_STRING LDT_TO_WSTRING LDT_TO_TIME_OF_DAY
    LDT_TO_DATE_AND_TIME LDT_TO_LDATE_AND_TIME LDT_TO_LTIME_OF_DAY LDT_TO___XINT LDT_TO___UXINT LDT_TO___XWORD
    LDT_TO_LDT
  `),
  "conversions-3": words(`
    STRING_TO_BOOL STRING_TO_BIT STRING_TO_BYTE STRING_TO_WORD STRING_TO_DWORD STRING_TO_LWORD STRING_TO_SINT
    STRING_TO_INT STRING_TO_DINT STRING_TO_LINT STRING_TO_USINT STRING_TO_UINT STRING_TO_UDINT STRING_TO_ULINT
    STRING_TO_REAL STRING_TO_LREAL STRING_TO_TIME STRING_TO_LTIME STRING_TO_DATE STRING_TO_TOD STRING_TO_DT
    STRING_TO_LDATE STRING_TO_LTOD STRING_TO_LDT STRING_TO_WSTRING STRING_TO_TIME_OF_DAY STRING_TO_DATE_AND_TIME
    STRING_TO_LDATE_AND_TIME STRING_TO_LTIME_OF_DAY STRING_TO___XINT STRING_TO___UXINT STRING_TO___XWORD
    STRING_TO_STRING WSTRING_TO_BOOL WSTRING_TO_BIT WSTRING_TO_BYTE WSTRING_TO_WORD WSTRING_TO_DWORD
    WSTRING_TO_LWORD WSTRING_TO_SINT WSTRING_TO_INT WSTRING_TO_DINT WSTRING_TO_LINT WSTRING_TO_USINT WSTRING_TO_UINT
    WSTRING_TO_UDINT WSTRING_TO_ULINT WSTRING_TO_REAL WSTRING_TO_LREAL WSTRING_TO_TIME WSTRING_TO_LTIME
    WSTRING_TO_DATE WSTRING_TO_TOD WSTRING_TO_DT WSTRING_TO_LDATE WSTRING_TO_LTOD WSTRING_TO_LDT WSTRING_TO_STRING
    WSTRING_TO_TIME_OF_DAY WSTRING_TO_DATE_AND_TIME WSTRING_TO_LDATE_AND_TIME WSTRING_TO_LTIME_OF_DAY
    WSTRING_TO___XINT WSTRING_TO___UXINT WSTRING_TO___XWORD WSTRING_TO_WSTRING TIME_OF_DAY_TO_BOOL
    TIME_OF_DAY_TO_BIT TIME_OF_DAY_TO_BYTE TIME_OF_DAY_TO_WORD TIME_OF_DAY_TO_DWORD TIME_OF_DAY_TO_LWORD
    TIME_OF_DAY_TO_SINT TIME_OF_DAY_TO_INT TIME_OF_DAY_TO_DINT TIME_OF_DAY_TO_LINT TIME_OF_DAY_TO_USINT
    TIME_OF_DAY_TO_UINT TIME_OF_DAY_TO_UDINT TIME_OF_DAY_TO_ULINT TIME_OF_DAY_TO_REAL TIME_OF_DAY_TO_LREAL
    TIME_OF_DAY_TO_TIME TIME_OF_DAY_TO_LTIME TIME_OF_DAY_TO_DATE TIME_OF_DAY_TO_TOD TIME_OF_DAY_TO_DT
    TIME_OF_DAY_TO_LDATE TIME_OF_DAY_TO_LTOD TIME_OF_DAY_TO_LDT TIME_OF_DAY_TO_STRING TIME_OF_DAY_TO_WSTRING
    TIME_OF_DAY_TO_DATE_AND_TIME TIME_OF_DAY_TO_LDATE_AND_TIME TIME_OF_DAY_TO_LTIME_OF_DAY TIME_OF_DAY_TO___XINT
    TIME_OF_DAY_TO___UXINT TIME_OF_DAY_TO___XWORD TIME_OF_DAY_TO_TIME_OF_DAY DATE_AND_TIME_TO_BOOL
    DATE_AND_TIME_TO_BIT DATE_AND_TIME_TO_BYTE DATE_AND_TIME_TO_WORD DATE_AND_TIME_TO_DWORD DATE_AND_TIME_TO_LWORD
    DATE_AND_TIME_TO_SINT DATE_AND_TIME_TO_INT DATE_AND_TIME_TO_DINT DATE_AND_TIME_TO_LINT DATE_AND_TIME_TO_USINT
    DATE_AND_TIME_TO_UINT DATE_AND_TIME_TO_UDINT DATE_AND_TIME_TO_ULINT DATE_AND_TIME_TO_REAL DATE_AND_TIME_TO_LREAL
    DATE_AND_TIME_TO_TIME DATE_AND_TIME_TO_LTIME DATE_AND_TIME_TO_DATE DATE_AND_TIME_TO_TOD DATE_AND_TIME_TO_DT
    DATE_AND_TIME_TO_LDATE DATE_AND_TIME_TO_LTOD DATE_AND_TIME_TO_LDT DATE_AND_TIME_TO_STRING
    DATE_AND_TIME_TO_WSTRING DATE_AND_TIME_TO_TIME_OF_DAY DATE_AND_TIME_TO_LDATE_AND_TIME
    DATE_AND_TIME_TO_LTIME_OF_DAY DATE_AND_TIME_TO___XINT DATE_AND_TIME_TO___UXINT DATE_AND_TIME_TO___XWORD
    DATE_AND_TIME_TO_DATE_AND_TIME LDATE_AND_TIME_TO_BOOL LDATE_AND_TIME_TO_BIT LDATE_AND_TIME_TO_BYTE
    LDATE_AND_TIME_TO_WORD LDATE_AND_TIME_TO_DWORD LDATE_AND_TIME_TO_LWORD LDATE_AND_TIME_TO_SINT
    LDATE_AND_TIME_TO_INT LDATE_AND_TIME_TO_DINT LDATE_AND_TIME_TO_LINT LDATE_AND_TIME_TO_USINT
    LDATE_AND_TIME_TO_UINT LDATE_AND_TIME_TO_UDINT LDATE_AND_TIME_TO_ULINT LDATE_AND_TIME_TO_REAL
    LDATE_AND_TIME_TO_LREAL LDATE_AND_TIME_TO_TIME LDATE_AND_TIME_TO_LTIME LDATE_AND_TIME_TO_DATE
    LDATE_AND_TIME_TO_TOD LDATE_AND_TIME_TO_DT LDATE_AND_TIME_TO_LDATE LDATE_AND_TIME_TO_LTOD LDATE_AND_TIME_TO_LDT
    LDATE_AND_TIME_TO_STRING LDATE_AND_TIME_TO_WSTRING LDATE_AND_TIME_TO_TIME_OF_DAY LDATE_AND_TIME_TO_DATE_AND_TIME
    LDATE_AND_TIME_TO_LTIME_OF_DAY LDATE_AND_TIME_TO___XINT LDATE_AND_TIME_TO___UXINT LDATE_AND_TIME_TO___XWORD
    LDATE_AND_TIME_TO_LDATE_AND_TIME LTIME_OF_DAY_TO_BOOL LTIME_OF_DAY_TO_BIT LTIME_OF_DAY_TO_BYTE
    LTIME_OF_DAY_TO_WORD LTIME_OF_DAY_TO_DWORD LTIME_OF_DAY_TO_LWORD LTIME_OF_DAY_TO_SINT LTIME_OF_DAY_TO_INT
    LTIME_OF_DAY_TO_DINT LTIME_OF_DAY_TO_LINT LTIME_OF_DAY_TO_USINT LTIME_OF_DAY_TO_UINT LTIME_OF_DAY_TO_UDINT
    LTIME_OF_DAY_TO_ULINT LTIME_OF_DAY_TO_REAL LTIME_OF_DAY_TO_LREAL LTIME_OF_DAY_TO_TIME LTIME_OF_DAY_TO_LTIME
    LTIME_OF_DAY_TO_DATE LTIME_OF_DAY_TO_TOD LTIME_OF_DAY_TO_DT LTIME_OF_DAY_TO_LDATE LTIME_OF_DAY_TO_LTOD
    LTIME_OF_DAY_TO_LDT LTIME_OF_DAY_TO_STRING LTIME_OF_DAY_TO_WSTRING LTIME_OF_DAY_TO_TIME_OF_DAY
    LTIME_OF_DAY_TO_DATE_AND_TIME LTIME_OF_DAY_TO_LDATE_AND_TIME LTIME_OF_DAY_TO___XINT LTIME_OF_DAY_TO___UXINT
    LTIME_OF_DAY_TO___XWORD LTIME_OF_DAY_TO_LTIME_OF_DAY __XINT_TO_BOOL __XINT_TO_BIT __XINT_TO_BYTE __XINT_TO_WORD
    __XINT_TO_DWORD __XINT_TO_LWORD __XINT_TO_SINT __XINT_TO_INT __XINT_TO_DINT __XINT_TO_LINT __XINT_TO_USINT
    __XINT_TO_UINT __XINT_TO_UDINT __XINT_TO_ULINT __XINT_TO_REAL __XINT_TO_LREAL __XINT_TO_TIME __XINT_TO_LTIME
    __XINT_TO_DATE __XINT_TO_TOD __XINT_TO_DT __XINT_TO_LDATE __XINT_TO_LTOD __XINT_TO_LDT __XINT_TO_STRING
    __XINT_TO_WSTRING __XINT_TO_TIME_OF_DAY __XINT_TO_DATE_AND_TIME __XINT_TO_LDATE_AND_TIME __XINT_TO_LTIME_OF_DAY
    __XINT_TO___UXINT __XINT_TO___XWORD __XINT_TO___XINT __UXINT_TO_BOOL __UXINT_TO_BIT __UXINT_TO_BYTE
    __UXINT_TO_WORD __UXINT_TO_DWORD __UXINT_TO_LWORD __UXINT_TO_SINT __UXINT_TO_INT __UXINT_TO_DINT __UXINT_TO_LINT
    __UXINT_TO_USINT __UXINT_TO_UINT __UXINT_TO_UDINT __UXINT_TO_ULINT __UXINT_TO_REAL __UXINT_TO_LREAL
    __UXINT_TO_TIME __UXINT_TO_LTIME __UXINT_TO_DATE __UXINT_TO_TOD __UXINT_TO_DT __UXINT_TO_LDATE __UXINT_TO_LTOD
    __UXINT_TO_LDT __UXINT_TO_STRING __UXINT_TO_WSTRING __UXINT_TO_TIME_OF_DAY __UXINT_TO_DATE_AND_TIME
    __UXINT_TO_LDATE_AND_TIME __UXINT_TO_LTIME_OF_DAY __UXINT_TO___XINT __UXINT_TO___XWORD __UXINT_TO___UXINT
    __XWORD_TO_BOOL __XWORD_TO_BIT __XWORD_TO_BYTE __XWORD_TO_WORD __XWORD_TO_DWORD __XWORD_TO_LWORD __XWORD_TO_SINT
    __XWORD_TO_INT __XWORD_TO_DINT __XWORD_TO_LINT __XWORD_TO_USINT __XWORD_TO_UINT __XWORD_TO_UDINT
    __XWORD_TO_ULINT __XWORD_TO_REAL __XWORD_TO_LREAL __XWORD_TO_TIME __XWORD_TO_LTIME __XWORD_TO_DATE
    __XWORD_TO_TOD __XWORD_TO_DT __XWORD_TO_LDATE __XWORD_TO_LTOD __XWORD_TO_LDT __XWORD_TO_STRING
    __XWORD_TO_WSTRING __XWORD_TO_TIME_OF_DAY __XWORD_TO_DATE_AND_TIME __XWORD_TO_LDATE_AND_TIME
    __XWORD_TO_LTIME_OF_DAY __XWORD_TO___XINT __XWORD_TO___UXINT __XWORD_TO___XWORD FOO_TO_INT BCD_TO_INT
    BCD_TO_DINT
  `),
}

/** The words the logs also asked as an ACTION, a PROPERTY and a top-level FB: every word refused as a METHOD in the
 *  first run and its first twelve accepted (the cross-check that the verdict is per word, not per kind). Their casing
 *  controls are `CASING_CANDIDATES.CROSS`. */
const CROSS_CANDIDATES = words(`
    FUNCTION_BLOCK END_FUNCTION_BLOCK PROGRAM END_PROGRAM FUNCTION END_FUNCTION METHOD END_METHOD ACTION END_ACTION
    PROPERTY END_PROPERTY INTERFACE END_INTERFACE TYPE END_TYPE STRUCT END_STRUCT UNION END_UNION VAR VAR_INPUT
    VAR_OUTPUT VAR_IN_OUT VAR_TEMP VAR_STAT VAR_INST VAR_EXTERNAL VAR_GLOBAL VAR_CONFIG VAR_ACCESS END_VAR CONSTANT
    RETAIN PERSISTENT PUBLIC PRIVATE PROTECTED INTERNAL FINAL ABSTRACT READ_ONLY READ_WRITE EXTENDS IMPLEMENTS ARRAY
    OF REFERENCE POINTER TO AT STRING WSTRING IF THEN ELSIF ELSE END_IF CASE END_CASE FOR BY DO END_FOR WHILE
    END_WHILE REPEAT UNTIL END_REPEAT RETURN EXIT CONTINUE JMP AND AND_THEN OR OR_ELSE NOT XOR MOD DIV TRUE FALSE
    ADD SUB MUL SHL SHR ROL ROR SEL MUX MIN MAX LIMIT GT LT GE LE EQ NE ABS SQRT LN LOG EXP EXPT SIN COS TAN ASIN
    ACOS ATAN ADR BITADR MOVE INDEXOF SIZEOF XSIZEOF TRUNC TRUNC_INT INI CAL __NEW __DELETE __ISVALIDREF
    __QUERYINTERFACE __QUERYPOINTER __TRY __CATCH __FINALLY __ENDTRY __VARINFO __CURRENTTASK __POSITION __POUNAME
    __COMPARE_AND_SWAP __XADD __POOL TEST_AND_SET __VECTOR VAR_GENERIC PARAMS THIS SUPER FROM R S LD LDN ST STN RET
    RETC RETCN JMPC JMPCN CALCN ANDN ORN XORN BOOL BIT BYTE WORD DWORD LWORD SINT INT DINT LINT USINT UINT UDINT
    ULINT REAL LREAL TIME LTIME DATE TOD DT LDATE LTOD LDT TIME_OF_DAY DATE_AND_TIME LDATE_AND_TIME LTIME_OF_DAY
    __XINT __UXINT __XWORD INT_TO_REAL REAL_TO_INT TO_INT TO_REAL BOOL_TO_INT ANY ANY_INT ANY_NUM ANY_REAL CALC
    __SYSTEM IMPLEMENTATION END_GET END_SET OVERRIDE GET SET NAMESPACE END_NAMESPACE LEN LEFT RIGHT MID CONCAT`)

/** `refused-names`' casing controls, FROZEN: every OTHER spelling the logs asked of a word the groups above ask
 *  (`log` / `Log` / `lOg` beside `LOG`, `To_Bool`, `__FOO` beside `__Foo` …; `git show 5312b799fe:packages/volt-cli/
 *  scripts/member-name-refusal{,-verify,-families}{,-tc}.log`). They are how the case-insensitivity every consumer relies
 *  on was measured — the drivers' lists match OrdinalIgnoreCase, the gate upper-cases each word — so a vendor build that
 *  starts refusing case-sensitively fails the gate (`RefusedNamesMatchTheSnapshotTests`: a spelling whose verdict differs
 *  from its word's). A tryNames step asks a word once, so each round of spellings is a step of its own: `METHOD` for
 *  the METHOD groups, `CROSS` for ACTION / PROPERTY / top-level FB. */
const CASING_CANDIDATES: { METHOD: string[][]; CROSS: string[][] } = {
  METHOD: [
    words(`
    __catch __compare_and_swap __currenttask __delete __endtry __finally __FOO __isvalidref __new __pool __position
    __pouname __queryinterface __querypointer __system __try __uxint __uxint_to_int __varinfo __vector __xadd __xint
    __xint_to_int __xword __xword_to_int abs abstract acos action add adr and and_then andn any any_int any_num
    any_real array asin at atan bit bit_to_int bitadr bool bool_to_int by byte byte_to_int cal calc calcn case
    constant continue cos date date_and_time date_and_time_to_int date_to_int dint dint_to_int div do dt dt_to_int
    dword dword_to_int else elsif end_action end_case end_for end_function end_function_block end_if end_interface
    end_program end_property end_repeat end_struct end_type end_union end_var end_while eq exit exp expt extends false
    final for from function function_block ge gt if implements indexof ini int int_to___uxint int_to___xint
    int_to___xword int_to_bit int_to_bool int_to_byte int_to_date int_to_date_and_time int_to_dint int_to_dt
    int_to_dword int_to_ldate int_to_ldate_and_time int_to_ldt int_to_lint int_to_lreal int_to_ltime
    int_to_ltime_of_day int_to_ltod int_to_lword int_to_real int_to_sint int_to_string int_to_time int_to_time_of_day
    int_to_tod int_to_udint int_to_uint int_to_ulint int_to_usint int_to_word int_to_wstring interface internal jmp
    jmpc jmpcn ld ldate ldate_and_time ldate_and_time_to_int ldate_to_int ldn ldt ldt_to_int le limit lint lint_to_int
    ln log lreal lreal_to_int lt ltime ltime_of_day ltime_of_day_to_int ltime_to_int ltod ltod_to_int lword
    lword_to_int max method Min mod move mul mux ne not of or or_else orn params persistent pointer private program
    property protected public r read_only read_write real real_to_int reference repeat ret retain retc retcn return
    rol ror s sel shl shr sin sint sint_to_int sizeof sqrt st stn string string_to_int struct sub super tan
    test_and_set then this time time_of_day time_of_day_to_int time_to_int to to___uxint to___xint to___xword to_bit
    to_bool to_byte to_date to_date_and_time to_dint to_dt to_dword to_int to_ldate to_ldate_and_time to_ldt to_lint
    to_lreal to_ltime to_ltime_of_day to_ltod to_lword to_real to_sint to_string to_time to_time_of_day to_tod
    to_udint to_uint to_ulint to_usint to_word to_wstring tod tod_to_int true trunc trunc_int type udint udint_to_int
    uint uint_to_int ulint ulint_to_int union until usint usint_to_int var var_access var_config var_external
    var_generic var_global var_in_out var_input var_inst var_output var_stat var_temp while word word_to_int wstring
    wstring_to_int xor xorn xsizeof
    `),
    words(`
    __uxint_To_Int __xint_To_Int __xword_To_Int Bit_To_Int Bool_To_Int Byte_To_Int Date_and_time_To_Int Date_To_Int
    Dint_To_Int Dt_To_Int Dword_To_Int Int_To___uxint Int_To___xint Int_To___xword Int_To_Bit Int_To_Bool Int_To_Byte
    Int_To_Date Int_To_Date_and_time Int_To_Dint Int_To_Dt Int_To_Dword Int_To_Ldate Int_To_Ldate_and_time Int_To_Ldt
    Int_To_Lint Int_To_Lreal Int_To_Ltime Int_To_Ltime_of_day Int_To_Ltod Int_To_Lword Int_To_Real Int_To_Sint
    Int_To_String Int_To_Time Int_To_Time_of_day Int_To_Tod Int_To_Udint Int_To_Uint Int_To_Ulint Int_To_Usint
    Int_To_Word Int_To_Wstring Ldate_and_time_To_Int Ldate_To_Int Ldt_To_Int Lint_To_Int Log Lreal_To_Int
    Ltime_of_day_To_Int Ltime_To_Int Ltod_To_Int Lword_To_Int min Real_To_Int Sint_To_Int String_To_Int
    Time_of_day_To_Int Time_To_Int To___uxint To___xint To___xword To_Bit To_Bool To_Byte To_Date To_Date_and_time
    To_Dint To_Dt To_Dword To_Int To_Ldate To_Ldate_and_time To_Ldt To_Lint To_Lreal To_Ltime To_Ltime_of_day To_Ltod
    To_Lword To_Real To_Sint To_String To_Time To_Time_of_day To_Tod To_Udint To_Uint To_Ulint To_Usint To_Word
    To_Wstring Tod_To_Int Udint_To_Int Uint_To_Int Ulint_To_Int Usint_To_Int Word_To_Int Wstring_To_Int
    `),
    words(`
    lOg
    `),
  ],
  CROSS: [
    words(`
    log Min public sin
    `),
    words(`
    Log
    `),
    words(`
    lOg
    `),
  ],
}

/** `refused-names`: one FB; each METHOD group under it; the cross-check words as ACTION / PROPERTY under it and as a
 *  top-level FB. Every write through the vendor API (a push meets the driver's own pre-flight, the list under test). */
function refusedNameSteps(): Step[] {
  const steps: Step[] = [
    {
      op: "create",
      as: "fb",
      kind: "function_block",
      name: "VltF_Names",
      parent: "root",
      via: "script",
      decl: DECL.function_block("VltF_Names"),
    },
  ]
  for (const [group, names] of Object.entries(METHOD_CANDIDATES))
    steps.push({ tag: `METHOD.${group}`, op: "tryNames", kind: "method", parent: "fb", names, via: "script" })
  const cross: [string, Kind, string][] = [
    ["ACTION", "action", "fb"],
    ["PROPERTY", "property", "fb"],
    ["TOPLEVEL", "function_block", "root"],
  ]
  for (const [label, kind, parent] of cross)
    steps.push({ tag: `${label}.vocabulary`, op: "tryNames", kind, parent, names: CROSS_CANDIDATES, via: "script" })
  CASING_CANDIDATES.METHOD.forEach((names, i) =>
    steps.push({ tag: `METHOD.casing-${i + 1}`, op: "tryNames", kind: "method", parent: "fb", names, via: "script" }),
  )
  for (const [label, kind, parent] of cross)
    CASING_CANDIDATES.CROSS.forEach((names, i) =>
      steps.push({ tag: `${label}.casing-${i + 1}`, op: "tryNames", kind, parent, names, via: "script" }),
    )
  return steps
}
/** One read per kind × group: its verdicts, keyed `<KIND>.<group>` (Repo.Gates `RefusedNamesMatchTheSnapshotTests`). */
const refusedNameReads = (): Read[] =>
  refusedNameSteps().flatMap((s): Read[] =>
    s.op === "tryNames" && s.tag ? [{ key: s.tag, at: s.tag, op: "tried", what: "verdicts" }] : [],
  )

/** `identifier-shapes`' names (C28): controls, non-ASCII letters, an Arabic-Indic digit, a leading digit, every ASCII
 *  punctuation mark a member line can carry, a no-break and a zero-width space, underscores, and backtick names — what
 *  `probe-identifier-names.py` asked (deleted, `git show 5312b799fe:packages/volt-cli/scripts/probe-identifier-names.py`;
 *  TwinCAT's `probe-tc-refusal-measure.ps1 -Phase names`, deleted with it, asked a subset). Non-ASCII as escapes. */
const SHAPES = [
  "Run",
  "_lead",
  "With9",
  "Trail_",
  "F\u00f6\u00f6bar",
  "\u00dcnit",
  "\u041f\u0440\u0438\u0432\u0435\u0442",
  "\u03b1\u03b2",
  "\u540d\u524d",
  "a\u0663",
  "2Fast",
  "My-Name",
  "a.b",
  "a$b",
  "a#b",
  "@ab",
  "a+b",
  "a/b",
  "a\\b",
  "a'b",
  'a"b',
  "a%b",
  "a&b",
  "a(b",
  "a[b",
  "a{b",
  "a;b",
  "a,b",
  "a=b",
  "a*b",
  "a!b",
  "a?b",
  "a^b",
  "a~b",
  "a|b",
  "a<b",
  "`ab`",
  "a\u00a0b",
  "a\u200bb",
  "_",
  "a__b",
  "`a-b`",
  "`F\u00f6\u00f6bar`",
  "`2Fast`",
  "`a b`",
  "`INT`",
  "``",
  "`ab",
  "a`b",
  "`a`b",
]
/** One tryNames per kind the drivers create (C28: a POU and the five member kinds). */
function shapeSteps(): Step[] {
  const kinds: [string, Kind, string][] = [
    ["pou", "function_block", "root"],
    ["method", "method", "fb"],
    ["action", "action", "fb"],
    ["property", "property", "fb"],
    ["itf_method", "method", "itf"],
    ["itf_property", "property", "itf"],
  ]
  return kinds.map(([tag, kind, parent]): Step => ({ tag, op: "tryNames", kind, parent, names: SHAPES, via: "script" }))
}
/** `identifier-shapes`: an FB and an interface to hold the members, every shape for each kind, then (CODESYS) a
 *  backtick-named program and method CREATED and BUILT, with a negative control: a name the compiler cannot read would
 *  be no usable object. */
function identifierShapeSteps(): Step[] {
  const steps: Step[] = [
    { vendor: "codesys", op: "open", fixture: "CodesysTestProject" },
    {
      op: "create",
      as: "fb",
      kind: "function_block",
      name: "VltF_IdFb",
      parent: "root",
      via: "script",
      decl: DECL.function_block("VltF_IdFb"),
    },
    { op: "create", as: "itf", kind: "interface", name: "IVltF_IdItf", parent: "root", via: "script" },
  ]
  steps.push(...shapeSteps())
  steps.push(
    { vendor: "codesys", op: "create", as: "bt", kind: "program", name: "`ab`", parent: "root", via: "script" },
    { vendor: "codesys", op: "create", as: "btm", kind: "method", name: "`ab`", parent: "fb", via: "script" },
    { vendor: "codesys", op: "find", as: "main", name: "PLC_PRG" },
    {
      vendor: "codesys",
      op: "setText",
      on: "main",
      via: "script",
      decl: "PROGRAM PLC_PRG\nVAR\n\tfb : VltF_IdFb;\nEND_VAR\n",
      impl: "fb();\n`ab`();\n",
    },
    { vendor: "codesys", tag: "built", op: "build" },
    { vendor: "codesys", op: "setText", on: "bt", via: "script", impl: "undefinedVltName := 1;\n" },
    { vendor: "codesys", tag: "negative", op: "build" },
  )
  return steps
}

/** `body-language-change`'s CODESYS subject (N24): an FB whose own body and every member body (method, action, property
 *  GET and SET) is ST, and the same FB with each body graphical — through the shipped push, as `volt push` sends it. */
function languageSource(graphical: boolean): string {
  const body = (lang: "LD" | "FBD", line: string) =>
    graphical ? `IMPLEMENTATION ${lang}\nNETWORK\n  ${line}\nEND_NETWORK\n` : `IMPLEMENTATION ST\n${line}\n`
  return (
    `FUNCTION_BLOCK VltF_Lc\nVAR\n\ta : BOOL;\n\tq : BOOL;\nEND_VAR\n${body("LD", "q := a;")}\nEND_FUNCTION_BLOCK\n` +
    `\nMETHOD Step : BOOL\n${body("FBD", "q := a;")}\nEND_METHOD\n` +
    `\nACTION Act\n${body("LD", "q := a;")}\nEND_ACTION\n` +
    `\nPROPERTY Ready : BOOL\nGET\n${body("FBD", "Ready := a;")}\nEND_GET\nSET\n${body("LD", "q := Ready;")}\nEND_SET\n` +
    `END_PROPERTY\n`
  )
}
const LC_DECL = (n: string) => `PROGRAM ${n}\nVAR\n\ta : BOOL := TRUE;\n\tq : BOOL;\nEND_VAR\n`

/** `task-priority-range`' values (C19c): what `probe-tc-refusal-measure.ps1 -Phase priority` (deleted, `git show
 *  5312b799fe:packages/volt-cli/scripts/probe-tc-refusal-measure.ps1`) sent, each XML-escaped into
 *  the system task's `<TaskDef><Priority>`; tagged `=<value>`. */
const PRIORITIES = [
  "abc",
  "-1",
  "0",
  "1.5",
  " 7 ",
  "+3",
  "0x10",
  "99999999999",
  "2147483648",
  "<5>",
  "&",
  "",
  "31",
  "32",
  "255",
  "256",
  "65535",
  "65536",
  "007",
]
const PRIORITY_TAGS = PRIORITIES.map((v) => `=${v}`)
const xmlEscape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
function prioritySteps(): Step[] {
  const steps: Step[] = [
    { op: "create", as: "sys", kind: "task_system", name: "VltF_Prio", parent: "tree:TIRT", via: "script" },
    // The PLC task links the schedule into the module, so its Context holds a copy (C19b).
    { tag: "created", op: "create", as: "plc", kind: "task_plc", name: "VltF_Prio", parent: "root", via: "script" },
  ]
  for (const v of PRIORITIES)
    steps.push({
      tag: `=${v}`,
      op: "invoke",
      on: "sys",
      path: "item.ConsumeXml",
      args: [`<TreeItem><TaskDef><Priority>${xmlEscape(v)}</Priority></TaskDef></TreeItem>`],
    })
  return steps
}

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
      // The text the IDE holds after each push: an accepted push that dropped its write would read the struct seed.
      {
        vendor: "codesys",
        key: "decl",
        at: ["seeded", "pushed"],
        on: ["p_enum", "p_union", "p_alias"],
        op: "member",
        path: "script.textual_declaration.text",
      },
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
      { op: "find", as: "abstract", name: "TakePicture", under: "basefb" },
      // The abstract PROPERTY's accessor: whether IT has an Implementation slot is a fact of its own (C2n).
      { op: "find", as: "busy", name: "Busy", under: "basefb" },
      { op: "find", as: "busyget", name: "Get", under: "busy" },
      // The other ABSTRACT member texts of pro2193 (openspec `abstract-member-push` 3.2): which class holds each, and
      // whether that class DECLARES an Implementation slot — the migration's expected set.
      { op: "find", as: "rejectfb", name: "RejectStation_BaseFB" },
      { op: "find", as: "getproducts", name: "GetProducts", under: "rejectfb" },
      { op: "find", as: "alarmfb", name: "ActuatorWithAlarm_BaseFB" },
      { op: "find", as: "alarms1", name: "Alarms", under: "alarmfb" },
      { op: "find", as: "manualalarmfb", name: "ActuatorWithManualControlAndAlarm_BaseFB" },
      { op: "find", as: "alarms2", name: "Alarms", under: "manualalarmfb" },
      { op: "find", as: "manualfb", name: "ActuatorWithManualControl_BaseFB" },
      { op: "find", as: "manualcontrol", name: "ManualControl", under: "manualfb" },
      { op: "find", as: "resettablefb", name: "ModuleResettableFB" },
      { op: "find", as: "reset", name: "Reset", under: "resettablefb" },
      { op: "find", as: "statefb", name: "ModuleWithStateFB" },
      { op: "find", as: "cyclic", name: "Cyclic", under: "statefb" },
      { op: "find", as: "estop", name: "EStop", under: "statefb" },
      { op: "find", as: "execute", name: "Execute", under: "statefb" },
      { op: "find", as: "execute1", name: "Execute_Sequence1", under: "statefb" },
      { tag: "found", op: "find", as: "stop", name: "Stop", under: "statefb" },
      // Update in place, rename, rename back + move, move home + original text — all through the shipped push. The
      // abstract method's in-place update is measured twice: the vendor's own (its declaration written through
      // scripting, `updated`), and — since `abstract-member-push` (the pull states it IMPLEMENTATION NONE and the push
      // writes no body there) — a line added beside it in its OWNER's pulled text, through the shipped push (`pushed`).
      { op: "setText", on: "check", via: "push", prepend: "// volt vendor-facts: written in place\n" },
      { op: "setText", on: "persistent", via: "push", prepend: "// volt vendor-facts: written in place\n" },
      { op: "setText", on: "textlist", via: "push", prepend: "// volt vendor-facts: written in place\n" },
      {
        tag: "updated",
        op: "setText",
        on: "abstract",
        via: "script",
        decl: "METHOD ABSTRACT TakePicture : enumResultTakePicture\n// volt vendor-facts: written in place\n",
      },
      {
        tag: "pushed",
        op: "setText",
        on: "basefb",
        via: "push",
        after: {
          line: "METHOD ABSTRACT TakePicture : enumResultTakePicture",
          add: "// volt vendor-facts: pushed beside the abstract member",
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
      { tag: "restored", op: "setText", on: "textlist", via: "push", restore: true },
    ],
    reads: [
      {
        key: "guid",
        at: ["found", "updated", "pushed", "renamed", "moved", "restored"],
        on: ["check", "persistent", "textlist", "abstract"],
        op: "guid",
      },
      {
        key: "class",
        at: ["found", "updated", "pushed", "renamed", "moved", "restored"],
        on: ["check", "persistent", "textlist", "abstract"],
        op: "class",
      },
      { key: "check-kind", at: ["found", "restored"], on: "check", op: "member", path: "object.KindOfCheckFunction" },
      // The write landed (or not): the declaration the IDE holds, before and after.
      {
        key: "decl",
        at: ["found", "updated", "pushed"],
        on: "abstract",
        op: "member",
        path: "script.textual_declaration.text",
      },
      // Which slots the abstract members have: null = no such aspect.
      {
        key: "implementation",
        at: "found",
        on: [
          "abstract",
          "busy",
          "busyget",
          "getproducts",
          "alarms1",
          "alarms2",
          "manualcontrol",
          "reset",
          "cyclic",
          "estop",
          "execute",
          "execute1",
          "stop",
        ],
        op: "member",
        path: "object.Implementation.$type",
      },
      { key: "class", at: "found", on: ["busy", "busyget"], op: "class" },
      // Whether each abstract site's CLASS declares `Implementation` (`NwlInterop.Has`): the `implementation` read above
      // is null both for a type without the member and for one holding null (openspec `abstract-member-push` design,
      // case (b) vs (c)). [] = not declared. Measured: every site declares it — a missing slot is case (c), the member
      // declared and holding null, which is what the driver states as IMPLEMENTATION NONE.
      {
        key: "implementation-declared",
        at: "found",
        on: [
          "abstract",
          "busyget",
          "getproducts",
          "alarms1",
          "alarms2",
          "manualcontrol",
          "reset",
          "cyclic",
          "estop",
          "execute",
          "execute1",
          "stop",
        ],
        op: "member",
        path: 'object.$methods("get_Implementation")',
      },
      {
        key: "class",
        at: "found",
        on: ["getproducts", "alarms1", "alarms2", "manualcontrol", "reset", "cyclic", "estop", "execute", "execute1", "stop"],
        op: "class",
      },
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
    // C2n's abstract members on TwinCAT (openspec `abstract-member-push` 1.1): does an abstract method / an abstract
    // property's accessor have a body slot, and does the owner's pulled text push back? CODESYS's half is
    // `merged-classes` (`implementation.*`): no Implementation aspect on either.
    id: "abstract-member-slot",
    dialect: ["C2n"],
    vendors: { twincat: true },
    steps: [
      // Through the vendor API: an ABSTRACT function block and an abstract method, declarations only.
      {
        op: "create",
        as: "sfb",
        kind: "function_block",
        name: "VltA_ScriptBase",
        parent: "root",
        via: "script",
        decl: "FUNCTION_BLOCK ABSTRACT VltA_ScriptBase\nVAR\nEND_VAR\n",
      },
      {
        tag: "script-made",
        op: "create",
        as: "smethod",
        kind: "method",
        name: "Pick",
        parent: "sfb",
        via: "script",
        decl: "METHOD ABSTRACT Pick : INT\n",
      },
      // Through the shipped push: the text a pull writes for an abstract member — the boundary line, an empty body. A
      // property's accessors are made only this way here: a CreateChild of a property (611) makes no Get/Set child
      // (measured, the first run: `find 'Get'` under it answered 0 items); the push creates the GET itself (613).
      {
        op: "create",
        as: "pfb",
        kind: "function_block",
        name: "VltA_PushBase",
        parent: "root",
        via: "push",
        source:
          `FUNCTION_BLOCK ABSTRACT VltA_PushBase\nVAR\n\tx : INT;\nEND_VAR\n${MARK}\nx := x + 1;\n\nEND_FUNCTION_BLOCK\n` +
          `\nMETHOD ABSTRACT Pick : INT\n${MARK}\n\nEND_METHOD\n` +
          `\nPROPERTY ABSTRACT Busy : BOOL\nGET\n${MARK}\n\nEND_GET\nEND_PROPERTY\n`,
      },
      { op: "find", as: "pmethod", name: "Pick", under: "pfb" },
      { op: "find", as: "pprop", name: "Busy", under: "pfb" },
      { tag: "push-made", op: "find", as: "pget", name: "Get", under: "pprop" },
      // Saved, closed, reopened: what the IDE wrote to the .TcPOU and loads back.
      { tag: "saved", op: "reload" },
      // The round trip CODESYS refuses: the owner's PULLED text, one line added under each abstract declaration.
      {
        tag: "method-edited",
        op: "setText",
        on: "pfb",
        via: "push",
        after: { line: "METHOD ABSTRACT Pick : INT", add: "// volt vendor-facts: written in place" },
      },
      {
        tag: "property-edited",
        op: "setText",
        on: "pfb",
        via: "push",
        after: { line: "PROPERTY ABSTRACT Busy : BOOL", add: "// volt vendor-facts: written in place" },
      },
      // A body written at the abstract method's slot through the vendor API.
      { tag: "body-written", op: "setText", on: "smethod", via: "script", impl: "Pick := 1;\n" },
    ],
    reads: [
      { key: "class", at: "script-made", on: ["sfb", "smethod"], op: "class" },
      { key: "class", at: "push-made", on: ["pfb", "pmethod", "pprop", "pget"], op: "class" },
      { key: "accessors", at: "saved", on: "pprop", op: "children" },
      // The body slot on the object: null = the COM object has no ImplementationText.
      {
        key: "implementation",
        at: ["script-made", "saved"],
        on: "smethod",
        op: "member",
        path: "item.ImplementationText",
      },
      {
        key: "implementation",
        at: ["push-made", "saved", "property-edited"],
        on: ["pmethod", "pprop", "pget"],
        op: "member",
        path: "item.ImplementationText",
      },
      {
        key: "declaration",
        at: ["saved", "property-edited"],
        on: ["smethod", "pmethod", "pprop"],
        op: "member",
        path: "item.DeclarationText",
      },
      // The body slot in the saved file: an <Implementation> element under the member, and its ST text.
      {
        key: "file.method",
        at: "saved",
        on: ["sfb", "pfb"],
        op: "xml",
        file: true,
        xpath: "//Method[@Name='Pick']/Implementation",
      },
      {
        key: "file.method-st",
        at: "saved",
        on: ["sfb", "pfb"],
        op: "xml",
        file: true,
        xpath: "//Method[@Name='Pick']/Implementation/ST",
      },
      {
        key: "file.get",
        at: "saved",
        on: "pfb",
        op: "xml",
        file: true,
        xpath: "//Property[@Name='Busy']/Get/Implementation",
      },
      {
        key: "file.get-st",
        at: "saved",
        on: "pfb",
        op: "xml",
        file: true,
        xpath: "//Property[@Name='Busy']/Get/Implementation/ST",
      },
      { key: "body", at: "body-written", on: "smethod", op: "member", path: "item.ImplementationText" },
      {
        key: "ide-authored",
        at: "start",
        op: "absent",
        reason:
          "no TwinCAT fixture or corpus holds an abstract member (0 ABSTRACT texts in Project13, Project14 and twincat-project14), so the IDE's own Add Method dialog is not measured; the members are made through the vendor API and the shipped push",
      },
    ],
  },
  {
    id: "folder-name-collision",
    dialect: ["D34"],
    vendors: { twincat: true },
    steps: [
      // Folder first, then an object of that name at the same level: accepted — the two coexist (D34).
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
      // Object first, then a folder of that name: refused (D34: an ORDER constraint, not a naming one).
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
      // int 0 is not asked: it opens a modal "CODESYS" message box that stops the UI thread (DIALECT C30, recorded
      // 2026-10-11, not kept — the run would end on the timeout with cleanup unable to run).
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
        at: ["found", "string", "int-1", "enum"],
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
      { key: "ui-culture", at: "start", op: "process", what: "culture" },
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
  {
    id: "refused-names",
    dialect: ["C28"],
    vendors: { codesys: true, twincat: true },
    steps: refusedNameSteps(),
    reads: refusedNameReads(),
  },
  {
    id: "identifier-shapes",
    dialect: ["C28"],
    vendors: { codesys: true, twincat: true },
    steps: identifierShapeSteps(),
    reads: [
      { key: "pou", at: "pou", op: "tried", what: "outcomes" },
      { key: "method", at: "method", op: "tried", what: "outcomes" },
      { key: "action", at: "action", op: "tried", what: "outcomes" },
      { key: "property", at: "property", op: "tried", what: "outcomes" },
      { key: "itf_method", at: "itf_method", op: "tried", what: "outcomes" },
      { key: "itf_property", at: "itf_property", op: "tried", what: "outcomes" },
      { vendor: "codesys", key: "diagnostics", at: ["built", "negative"], op: "diagnostics" },
    ],
  },
  {
    id: "task-priority-range",
    dialect: ["C19c"],
    vendors: { twincat: true },
    steps: prioritySteps(),
    reads: [
      { key: "taskdef-created", at: "created", on: "sys", op: "xml", xpath: "/TreeItem/TaskDef/Priority" },
      { key: "taskdef", at: PRIORITY_TAGS, on: "sys", op: "xml", xpath: "/TreeItem/TaskDef/Priority" },
      { key: "context", at: PRIORITY_TAGS, on: "sys", op: "xml", xpath: "//TcModuleInstance//Context//Priority" },
    ],
  },
  {
    id: "interface-accessor-write",
    dialect: ["D41"],
    vendors: { codesys: true },
    steps: [
      { op: "open", fixture: "CodesysTestProject" },
      { op: "create", as: "itf", kind: "interface", name: "IVltF_Acc", parent: "root", via: "script" },
      { op: "create", as: "prop", kind: "property", name: "P", parent: "itf", via: "script" },
      { op: "find", as: "get", name: "Get", under: "prop" },
      { op: "find", as: "set", name: "Set", under: "prop" },
      // An FB implementing it, used through the interface: the build compiles the accessors' callers.
      {
        op: "create",
        as: "fb",
        kind: "function_block",
        name: "VltF_AccFb",
        parent: "root",
        via: "script",
        decl: "FUNCTION_BLOCK VltF_AccFb IMPLEMENTS IVltF_Acc\nVAR\n\tv : INT;\nEND_VAR\n",
      },
      { op: "create", as: "fbp", kind: "property", name: "P", parent: "fb", via: "script" },
      { op: "find", as: "fget", name: "Get", under: "fbp" },
      { op: "setText", on: "fget", via: "script", impl: "P := v;\n" },
      { op: "find", as: "fset", name: "Set", under: "fbp" },
      { op: "setText", on: "fset", via: "script", impl: "v := P;\n" },
      { op: "find", as: "main", name: "PLC_PRG" },
      {
        op: "setText",
        on: "main",
        via: "script",
        decl: "PROGRAM PLC_PRG\nVAR\n\tf : VltF_AccFb;\n\ti : IVltF_Acc;\n\tx : INT;\nEND_VAR\n",
        impl: "i := f;\nx := i.P;\ni.P := x + 1;\n",
      },
      { tag: "created", op: "build" },
      // Each accessor: its declaration written, then a body asked of a slot it does not have, then a build.
      { tag: "set-written", op: "setText", on: "set", via: "script", decl: "VAR\n\ttmp : INT;\nEND_VAR\n" },
      { tag: "set-body", op: "setText", on: "set", via: "script", impl: "tmp := 1;\n" },
      { tag: "set-built", op: "build" },
      { tag: "get-written", op: "setText", on: "get", via: "script", decl: "VAR\n\ttmp : INT;\nEND_VAR\n" },
      { tag: "get-body", op: "setText", on: "get", via: "script", impl: "tmp := 1;\n" },
      { tag: "get-built", op: "build" },
    ],
    reads: [
      {
        key: "has-implementation",
        at: "created",
        on: ["get", "set"],
        op: "member",
        path: "script.has_textual_implementation",
      },
      { key: "implementation-aspect", at: "created", on: ["get", "set"], op: "member", path: "object.Implementation" },
      {
        key: "declaration",
        at: ["created", "set-written", "get-written"],
        on: ["get", "set"],
        op: "member",
        path: "script.textual_declaration.text",
      },
      { key: "diagnostics", at: ["created", "set-built", "get-built"], op: "diagnostics" },
      { key: "accessors", at: "end", on: "prop", op: "children" },
    ],
  },
  {
    id: "body-language-change",
    dialect: ["N24"],
    vendors: { codesys: true, twincat: true },
    steps: [
      // CODESYS: through the shipped push — the vendor takes a body of the other language on the SAME object.
      { vendor: "codesys", op: "open", fixture: "CodesysTestProject" },
      {
        vendor: "codesys",
        op: "create",
        as: "pou",
        kind: "function_block",
        name: "VltF_Lc",
        parent: "root",
        via: "push",
        source: languageSource(false),
      },
      { vendor: "codesys", op: "find", as: "m", name: "Step", under: "pou" },
      { vendor: "codesys", op: "find", as: "act", name: "Act", under: "pou" },
      { vendor: "codesys", op: "find", as: "prop", name: "Ready", under: "pou" },
      { vendor: "codesys", op: "find", as: "get", name: "Get", under: "prop" },
      { vendor: "codesys", tag: "created", op: "find", as: "set", name: "Set", under: "prop" },
      { vendor: "codesys", op: "find", as: "main", name: "PLC_PRG" },
      {
        vendor: "codesys",
        op: "setText",
        on: "main",
        via: "script",
        decl: "PROGRAM PLC_PRG\nVAR\n\tlc : VltF_Lc;\nEND_VAR\n",
        impl: "lc();\nlc.Step();\nlc.Act();\nlc.Ready := lc.Ready;\n",
      },
      { vendor: "codesys", tag: "st-built", op: "build" },
      { vendor: "codesys", tag: "graphical", op: "setText", on: "pou", via: "push", source: languageSource(true) },
      { vendor: "codesys", tag: "graphical-built", op: "build" },
      { vendor: "codesys", tag: "st-again", op: "setText", on: "pou", via: "push", source: languageSource(false) },
      { vendor: "codesys", tag: "st-again-built", op: "build" },
      // TwinCAT: ImplementationText, the one write a body has — ST over an FBD body, the FBD archive over an ST body.
      {
        vendor: "twincat",
        op: "create",
        as: "fbd",
        kind: "program",
        name: "VltF_LcFbd",
        parent: "root",
        via: "script",
        language: "FBD",
        decl: LC_DECL("VltF_LcFbd"),
      },
      {
        vendor: "twincat",
        tag: "made",
        op: "create",
        as: "st",
        kind: "program",
        name: "VltF_LcSt",
        parent: "root",
        via: "script",
        decl: LC_DECL("VltF_LcSt"),
        impl: "q := a;\n",
      },
      { vendor: "twincat", tag: "st-over-fbd", op: "setText", on: "fbd", via: "script", impl: "q := NOT a;\n" },
      { vendor: "twincat", tag: "fbd-over-st", op: "setText", on: "st", via: "script", implFrom: "fbd" },
      { vendor: "twincat", op: "find", as: "main", name: "PLC_PRG" },
      {
        vendor: "twincat",
        op: "setText",
        on: "main",
        via: "push",
        after: { line: "IMPLEMENTATION ST", add: "VltF_LcFbd();\nVltF_LcSt();" },
      },
      { vendor: "twincat", tag: "built", op: "build" },
    ],
    reads: [
      {
        vendor: "codesys",
        key: "guid",
        at: ["created", "graphical", "st-again"],
        on: ["pou", "m", "act", "get", "set"],
        op: "guid",
      },
      {
        vendor: "codesys",
        key: "aspect",
        at: ["created", "graphical", "st-again"],
        on: ["pou", "m", "act", "get", "set"],
        op: "member",
        path: "object.Implementation.$type",
      },
      {
        vendor: "codesys",
        key: "diagnostics",
        at: ["st-built", "graphical-built", "st-again-built"],
        op: "diagnostics",
      },
      // The WHOLE text, not its element names: N24's "unchanged" and "read back verbatim" are about every attribute
      // and value (the FBD archive the ST body took is `fbd-body@made`, byte for byte).
      {
        vendor: "twincat",
        key: "fbd-body",
        at: ["made", "st-over-fbd"],
        on: "fbd",
        op: "member",
        path: "item.ImplementationText",
      },
      {
        vendor: "twincat",
        key: "st-body",
        at: ["made", "fbd-over-st"],
        on: "st",
        op: "member",
        path: "item.ImplementationText",
      },
      { vendor: "twincat", key: "diagnostics", at: "built", op: "diagnostics" },
    ],
  },
  {
    id: "move-target",
    dialect: ["C2q"],
    vendors: { codesys: true, twincat: true },
    steps: [
      { vendor: "codesys", op: "open", fixture: "CodesysTestProject" },
      { op: "create", as: "folder", kind: "folder", name: "VltF_MvFolder", parent: "root", via: "script" },
      {
        op: "create",
        as: "subject",
        kind: "program",
        name: "VltF_Mv",
        parent: "root",
        via: "script",
        decl: DECL.program("VltF_Mv"),
      },
      // CODESYS: nodes that hold no top-level item — the device, the task configuration.
      { vendor: "codesys", op: "find", as: "device", name: "Device" },
      { vendor: "codesys", op: "find", as: "taskconfig", name: "Task Configuration" },
      // The control: a folder holds it.
      { tag: "into-folder", op: "move", on: "subject", to: "folder", via: "script" },
      { vendor: "codesys", tag: "into-device", op: "move", on: "subject", to: "device", via: "script" },
      { vendor: "codesys", tag: "into-taskconfig", op: "move", on: "subject", to: "taskconfig", via: "script" },
      // TwinCAT: its one move, the archive round trip (export, delete, import — D4f), into a POU node (602, a program,
      // as the deleted probe's `POUs/POUexecute`) and into References.
      {
        vendor: "twincat",
        op: "create",
        as: "pou",
        kind: "program",
        name: "VltF_MvTarget",
        parent: "root",
        via: "script",
        decl: DECL.program("VltF_MvTarget"),
      },
      { vendor: "twincat", tag: "into-pou", op: "move", on: "subject", to: "pou", via: "script" },
      {
        vendor: "twincat",
        op: "create",
        as: "subject2",
        kind: "program",
        name: "VltF_Mv2",
        parent: "folder",
        via: "script",
        decl: DECL.program("VltF_Mv2"),
      },
      { vendor: "twincat", op: "find", as: "references", name: "References" },
      { vendor: "twincat", tag: "into-references", op: "move", on: "subject2", to: "references", via: "script" },
    ],
    reads: [
      {
        vendor: "codesys",
        key: "parent",
        at: ["into-folder", "into-device", "into-taskconfig"],
        on: "subject",
        op: "parent",
      },
      // Where the subject stayed is half of it; the other half is that the node it was moved into holds no copy.
      { vendor: "codesys", key: "device-children", at: ["into-folder", "into-device"], on: "device", op: "children" },
      {
        vendor: "codesys",
        key: "taskconfig-children",
        at: ["into-device", "into-taskconfig"],
        on: "taskconfig",
        op: "children",
      },
      { vendor: "twincat", key: "parent", at: "into-folder", on: "subject", op: "parent" },
      { vendor: "twincat", key: "folder-children", at: ["into-pou", "into-references"], on: "folder", op: "children" },
      { vendor: "twincat", key: "pou-children", at: "into-pou", on: "pou", op: "children" },
      { vendor: "twincat", key: "references-children", at: "into-references", on: "references", op: "children" },
      { vendor: "twincat", key: "root-children", at: ["into-pou", "into-references"], on: "root", op: "children" },
    ],
  },
]
