/**
 * THE VENDOR-FACT TABLE — every re-measurable vendor fact `DIALECT.md` marks `[PROBE: <id>]`, as ONE row each (openspec
 * `vendor-fact-probe`). `vendor-facts.ts` runs the rows on its own `ide.ps1` instance and diffs what the IDE answers
 * against the committed `vendor-facts.<vendor>.json`. A new vendor question is a new ROW here — never a new probe script.
 *
 * A row is a scenario in a small CLOSED vocabulary that each vendor core implements once (design.md "0.1"):
 *
 *   steps   create · find · setText · rename · move · delete · open · close · build · reload · invoke · tryNames
 *   reads   member · class · guid · parent · children · signature · parse · xml · same · diagnostics · process · absent
 *           · tried · fetched · archive · objects · nwl
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
        /** A property's data type (CODESYS `create_property`'s type, TwinCAT 611's vInfo); `INT` on CODESYS when not
         *  named, and on TwinCAT the driver's own vInfo — the body language, which TwinCAT reads AS the type
         *  (bridge-one-to-one gate 1: `PROPERTY PUBLIC Beta : ST`). A property create only. */
        dataType?: string
        /** CODESYS only (openspec `bridge-one-to-one` 1.3): a class no scripting `create_*` names, made the way the
         *  vendor's own Add Object makes it. `factory`: that `IObjectFactory` (full CLR name) — `Create()`, then
         *  `ObjectMgr.AddObject` under the parent, then its `ObjectCreated`. `vendorClass`: that class by its
         *  parameterless constructor, each `Interface` / `Implementation` aspect it holds null taken from the POU
         *  factory's own `DoCreate` (ST, standard level, `decl`), the `init` members set, then `AddObject`. The kind
         *  stays the wire kind the object answers as. */
        factory?: string
        vendorClass?: string
        init?: Record<string, Arg>
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
    /** The subject's own editor opened in the IDE and closed again (CODESYS `IFrame.OpenEditorView` / `CloseView`;
     *  TwinCAT its DTE project item opened and closed saving) — what an engineer does by looking at a body. */
    | { op: "editor"; on: Handle }
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
    /** The subject's item text as the SHIPPED bridge's `fetch` answers it — what `volt pull` writes — read by the runner
     *  over the pipe, never by a core. The subject is a wire item (a POU, DUT, GVL or interface), not a member: a member's
     *  text is its owner's. */
    | { op: "fetched" }
    /** The vendor's OWN archive of the subject and every descendant (openspec <c>bridge-one-to-one</c> 2.1, the
     *  completeness oracle; the 0.1 census walk made permanent): CODESYS the object's, its IMetaObject's and every
     *  IObjectProperty's `SerializableValueNames`, TwinCAT the backing file's elements and attributes plus its `.plcproj`
     *  entry — flattened to `{ "<descendant path>": { "<member path>": value } }`, `""` the subject. */
    | { op: "archive" }
    /** Every object of the open project, with its class (CODESYS) or tree code (TwinCAT) — what the completeness runner
     *  picks its subjects from. */
    | { op: "objects" }
    /** The subject's graphical body as the vendor ARCHIVES it (openspec <c>ld-fbd-coverage</c> 2.2): CODESYS
     *  `GetSerializableValue` from the NWLImplementationObject down (the archive, not the API — DIALECT N27), TwinCAT its
     *  backing file's `<XmlArchive>`, flattened in ONE notation (N1: one model) to `{ "<member path>": value }` —
     *  `NetworkList[0].NetworkItems[1].RValue.Flags.Fixed`; an object `<its class>`, a list `#count` and `[i]`, a scalar
     *  its value (an id a number, a quoted string unquoted). `members`: only the paths whose LAST member, its list index
     *  dropped, is one of these (`Types` keeps `…InputParam.Types[0]`); `network`: only network n's paths. The class
     *  markers name each vendor's own classes, so a row comparing vendors filters by member. */
    | { op: "nwl"; members?: string[]; network?: number }
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
const MARK = "%LANGUAGE ST"
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
    `PROGRAM ${n}\nVAR\n${vars}\nEND_VAR\n%LANGUAGE ${lang}\nNETWORK\n  ${net}\nEND_NETWORK\n\nEND_PROGRAM\n`,
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
    graphical ? `%LANGUAGE ${lang}\nNETWORK\n  ${line}\nEND_NETWORK\n` : `%LANGUAGE ST\n${line}\n`
  return (
    `FUNCTION_BLOCK VltF_Lc\nVAR\n\ta : BOOL;\n\tq : BOOL;\nEND_VAR\n${body("LD", "q := a;")}\nEND_FUNCTION_BLOCK\n` +
    `\nMETHOD Step : BOOL\n${body("FBD", "q := a;")}\nEND_METHOD\n` +
    `\nACTION Act\n${body("LD", "q := a;")}\nEND_ACTION\n` +
    `\nPROPERTY Ready : BOOL\nGET\n${body("FBD", "Ready := a;")}\nEND_GET\nSET\n${body("LD", "q := Ready;")}\nEND_SET\n` +
    `END_PROPERTY\n`
  )
}
const LC_DECL = (n: string) => `PROGRAM ${n}\nVAR\n\ta : BOOL := TRUE;\n\tq : BOOL;\nEND_VAR\n`

/** `nwl-keep-network-in-place`'s subject (ld-fbd-coverage 1b.4, DIALECT N28): a four-network LD body, each network one
 *  rung, as the shipped push writes it — and the same body after one push that inserts a network before #2, removes #3
 *  and edits #4 (network text, `packages/volt-cli/docs/network-text.html`). */
function keepSource(after: boolean): string {
  const nets = after
    ? ["o1 := a;", "o5 := b;", "o2 := a AND b;", "o4 := b;"]
    : ["o1 := a;", "o2 := a AND b;", "o3 := b;", "o4 := a;"]
  return (
    `PROGRAM VltF_Keep\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\to1 : BOOL;\n\to2 : BOOL;\n\to3 : BOOL;\n\to4 : BOOL;\n\to5 : BOOL;\nEND_VAR\n` +
    `%LANGUAGE LD\n${nets.map((n) => `NETWORK\n  ${n}\nEND_NETWORK\n`).join("")}\nEND_PROGRAM\n`
  )
}

// ── ld-fbd-coverage 2.2: the NWL probe rows' subjects ───────────────────────────────────────────────────────────

/** A graphical program as `volt push` sends it: its variables, then one network per entry — a statement line, or
 *  `{ header, lines }` for a network that carries a header field or several statements (network text,
 *  `packages/volt-cli/docs/network-text.html`). */
type NwlNet = string | { header?: string; lines: string[] }
function nwlProgram(name: string, vars: string[], lang: "LD" | "FBD", nets: NwlNet[]): string {
  const block = (n: NwlNet) =>
    typeof n === "string"
      ? `NETWORK\n  ${n}\nEND_NETWORK\n`
      : `NETWORK${n.header ? " " + n.header : ""}\n${n.lines.map((l) => "  " + l).join("\n")}\nEND_NETWORK\n`
  return (
    `PROGRAM ${name}\nVAR\n${vars.map((v) => `\t${v};\n`).join("")}END_VAR\n` +
    `%LANGUAGE ${lang}\n${nets.map(block).join("")}\nEND_PROGRAM\n`
  )
}

/** The callees the rows' call boxes name, as `volt push` sends them: a function, a program, a DINT function, a DUT
 *  alias, a base FB (S5) and an FB with a BOOL input (S6). */
const NWL_CALLEE = {
  fn: `FUNCTION VltF_RFn : INT\nVAR_INPUT\n\tx : INT;\nEND_VAR\n%LANGUAGE ST\nVltF_RFn := x;\n\nEND_FUNCTION\n`,
  prg: `PROGRAM VltF_RPrg\nVAR\n\tc : INT;\nEND_VAR\n%LANGUAGE ST\nc := c + 1;\n\nEND_PROGRAM\n`,
  dintFn: `FUNCTION VltF_LwFn : DINT\nVAR_INPUT\n\tx : DINT;\nEND_VAR\n%LANGUAGE ST\nVltF_LwFn := x;\n\nEND_FUNCTION\n`,
  alias: `TYPE VltF_LwAl : INT;\nEND_TYPE\n`,
  base: `FUNCTION_BLOCK VltF_S5Base\nVAR\n\tn : INT;\nEND_VAR\n%LANGUAGE ST\nn := n + 1;\n\nEND_FUNCTION_BLOCK\n`,
  pinFb:
    `FUNCTION_BLOCK VltF_S6Fb\nVAR_INPUT\n\txEnable : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tq : BOOL;\nEND_VAR\n` +
    `%LANGUAGE ST\nq := xEnable;\n\nEND_FUNCTION_BLOCK\n`,
}
const NWL_CALLEE_KIND: Record<keyof typeof NWL_CALLEE, [Kind, string]> = {
  fn: ["function", "VltF_RFn"],
  prg: ["program", "VltF_RPrg"],
  dintFn: ["function", "VltF_LwFn"],
  alias: ["dut", "VltF_LwAl"],
  base: ["function_block", "VltF_S5Base"],
  pinFb: ["function_block", "VltF_S6Fb"],
}

/** The R rows' common subject (design "1b.2", the 2.2 rows): the shapes the LD corpus bodies hold most — contacts, a
 *  negated one, an AND box, coils, an FB call and its output read in the next network, an arithmetic operator box. (An
 *  FB output pin `Q => o2` and an enabled MOVE writing a result pin are refused before TwinCAT's import — Volt's own
 *  lowering — so either would leave the TwinCAT half without a subject.) */
const NWL_R_BASE = nwlProgram(
  "VltF_R",
  ["a : BOOL", "b : BOOL", "i : INT", "j : INT", "o1 : BOOL", "o2 : BOOL", "t1 : TON"],
  "LD",
  ["o1 := a AND NOT b;", "t1(IN := a, PT := T#1S);", "o2 := t1.Q;", "j := i ADD 1;"],
)
/** A box of each CallType a corpus box holds (FunctionBlock, Function, Program, an operator): the call rows' subject. */
const NWL_R_CALLS = nwlProgram(
  "VltF_RC",
  ["a : BOOL", "b : BOOL", "i : INT", "j : INT", "k : INT", "o1 : BOOL", "t1 : TON"],
  "LD",
  [
    "k := VltF_RFn(x := i);",
    "VltF_RPrg() EN b;",
    "t1(IN := a, PT := T#1S);",
    "o1 := a AND b;",
    "j := i ADD 1;",
  ],
)
/** ld-fbd-coverage 2R.1 C1: the boxes whose `OutputParam` Names/Types an IDE-drawn box stores and a pushed one derives —
 *  a function's result, an FB call with no output wired, an FB consumed by its main output, an operator group, an
 *  arithmetic box and a comparison — and the networks where an editor would have a reason to touch the other members:
 *  a negated contact, a parallel branch (`BranchCounter`), an enabled MOVE and an enabled function read through its
 *  ENO (`EN`/`ENO`). */
const NWL_EDITOR = nwlProgram(
  "VltF_RE",
  [
    "a : BOOL", "b : BOOL", "c : BOOL", "i : INT", "j : INT", "k : INT", "m : INT", "o1 : BOOL", "o2 : BOOL",
    "o3 : BOOL", "o4 : BOOL", "o5 : BOOL", "o6 : BOOL", "t1 : TON", "t2 : TON",
  ],
  "LD",
  [
    "k := VltF_RFn(x := i);",
    "t1(IN := a, PT := T#1S);",
    "o1 := t2(IN := b, PT := T#2S);",
    "o2 := a AND b;",
    "j := i ADD 1;",
    "o3 := i GT j;",
    "o4 := a AND NOT b;",
    "o5 := a BRANCH (b, NOT c) SHORTCIRCUIT;",
    "MOVE 750 => m EN a;",
    { lines: ["VltF_RFn(i) EN b", "o6 := ENO;"] },
  ],
)
/** The FBD half of C1: an operator tree, a negated operator PIN (FBD's negation, `InputFlags`), an enabled function
 *  read through its ENO and an enabled MOVE. */
const NWL_EDITOR_FBD = nwlProgram(
  "VltF_RF",
  ["a : BOOL", "b : BOOL", "c : BOOL", "q : BOOL", "i : INT", "m : INT", "o : BOOL", "p : BOOL", "ok : BOOL"],
  "FBD",
  [
    "o := ((a AND b AND c) OR (a AND b)) AND q;",
    "p := AND(NOT IN1 := a, b);",
    { lines: ["VltF_RFn(i) EN a", "ok := ENO;"] },
    "MOVE 7 => m EN b;",
  ],
)
/** The members C1 reads at every point (the input pin flags too: FBD's negation). */
const NWL_EDITOR_MEMBERS = [
  "BoxType", "Names", "Types", "Names#count", "Types#count", "OutputItems#count", "Fixed", "Boolean", "Address",
  "BranchCounter", "EN", "ENO", "CallType", "InputFlags",
]
/** An Execute box (CallType None; the snippet's per-line ids). */
const NWL_R_EXEC = nwlProgram("VltF_RX", ["a : BOOL", "k : INT"], "LD", [
  { lines: ["EXECUTE EN a", "k := k + 1;", "k := k * 2;", "END_EXECUTE;"] },
])
/** A RETURN and a JMP built by the push (the assign item's own Jump/Return bit). */
const NWL_R_FLOW = nwlProgram("VltF_RJ", ["a : BOOL", "b : BOOL", "o1 : BOOL"], "LD", [
  "RETURN := a;",
  "JMP l1 := b;",
  { header: "LABEL: l1", lines: ["o1 := a;"] },
])
/** A Parallel (the body's BranchCounter). */
const NWL_R_PAR = nwlProgram("VltF_RP", ["a : BOOL", "b : BOOL", "c : BOOL", "o1 : BOOL"], "LD", [
  "o1 := a BRANCH (b, NOT c) SHORTCIRCUIT;",
])

/** S3b (`nwl-rail-fed-wire`): a split fed by the empty terminator (the left rail, `split1 := ;`), and — its own subject, so
 *  a refusal of one leaves the other measured — the same wire fed by TRUE. */
const NWL_RAIL = nwlProgram("VltF_Rail", ["a : BOOL", "b : BOOL", "o1 : BOOL", "o2 : BOOL"], "LD", [
  { lines: ["split1 := ;", "o1 := split1 AND a;", "o2 := split1 AND b;"] },
])
const NWL_RAIL_TRUE = nwlProgram("VltF_RailT", ["a : BOOL", "b : BOOL", "o1 : BOOL", "o2 : BOOL"], "LD", [
  { lines: ["split1 := TRUE;", "o1 := split1 AND a;", "o2 := split1 AND b;"] },
])
/** S3a (`nwl-leaf-wire-type`, owner amendment a): a wire fed by a LEAF — an INT leaf into DINT pins, a leaf of an alias
 *  type, and the census's own WSM shape (a BOOL leaf into an FB's BOOL pins, `R_TRIG.CLK` and `TON.IN`). */
const NWL_LEAF_WIRE = nwlProgram(
  "VltF_Lw",
  ["a : BOOL", "i : INT", "al : VltF_LwAl", "d : DINT", "e : DINT", "f : DINT", "k : INT", "t1 : TON", "r1 : R_TRIG"],
  "LD",
  [
    { lines: ["split1 := i;", "d := VltF_LwFn(x := split1);", "e := VltF_LwFn(x := split1);"] },
    { lines: ["split2 := al;", "f := VltF_LwFn(x := split2);", "k := MOVE split2;"] },
    { lines: ["split3 := a;", "t1(IN := split3, PT := T#1S);", "r1(CLK := split3);"] },
  ],
)
/** S1 (`nwl-bitop-stored-slot`): SetAlarm's network 0 in the plain form a push builds today — bit operator boxes
 *  consumed by other bit operators (pro2193 `Cylinder_53ValveFB.SetAlarm`, census 0.2) — and a consumed NOT box. */
const NWL_S1_PLAIN = nwlProgram(
  "VltF_S1",
  ["a : BOOL", "b : BOOL", "c : BOOL", "q : BOOL", "o : BOOL", "p : BOOL"],
  "FBD",
  ["o := ((a AND b AND c) OR (a AND b) OR (b AND c)) AND q;", "p := NOT (a AND b) AND c;"],
)
/** S2, S6 and S5 in the spelling design 1.1 gives them — what the push answers before 2.3 spells them. */
const NWL_S2 = nwlProgram("VltF_S2", ["a : BOOL", "b : BOOL", "o1 : BOOL", "o2 : BOOL", "k : INT"], "LD", [
  "MOVE 750 => k EN (o1 := a AND b);",
  "MOVE 7 => k EN (o2 S= a AND b);",
])
const NWL_S6 = nwlProgram("VltF_S6", ["a : BOOL", "b : BOOL", "o1 : BOOL", "fb1 : VltF_S6Fb"], "FBD", [
  "fb1(NOT xEnable := a);",
  "o1 := AND(NOT IN1 := a, b);",
])
const NWL_S5 =
  "FUNCTION_BLOCK VltF_S5 EXTENDS VltF_S5Base\nVAR\nEND_VAR\n%LANGUAGE LD\nNETWORK\n  `SUPER^`();\nEND_NETWORK\n\n" +
  "END_FUNCTION_BLOCK\n"

/** The steps every NWL row takes: the callees and the subject created through the shipped push (`pushed`), the subject
 *  called from PLC_PRG so the build compiles it (`called`), a build (`built`), save/close/reopen (`reloaded`) and a build
 *  of the reopened project (`rebuilt`) — the R rows' question: does the IDE fill a member the push did not write, on a
 *  build or a reopen (design 1b.2: "push without it, save/reopen, read back, build"). */
type NwlSubject = { as: string; name: string; source: string; kind?: Kind }
function nwlSteps(subject: NwlSubject, callees: (keyof typeof NWL_CALLEE)[] = [], beside: NwlSubject[] = []): Step[] {
  const kind = subject.kind ?? "program"
  // Only the main subject is called: a subject beside it may be refused, and a call of it would fail the build for that
  // reason alone (measured: TwinCAT's PLC_PRG then reports it undefined). Every POU of the project is compiled anyway.
  const call = kind === "program" ? `${subject.name}();` : ""
  const steps: Step[] = [{ vendor: "codesys", op: "open", fixture: "CodesysTestProject" }]
  for (const c of callees)
    steps.push({
      op: "create",
      as: `callee_${c}`,
      kind: NWL_CALLEE_KIND[c][0],
      name: NWL_CALLEE_KIND[c][1],
      parent: "root",
      via: "push",
      source: NWL_CALLEE[c],
    })
  // A subject beside the main one first: `pushed` tags the last create, so every subject exists when it is read.
  for (const b of beside)
    steps.push({ op: "create", as: b.as, kind: b.kind ?? "program", name: b.name, parent: "root", via: "push", source: b.source })
  steps.push({ tag: "pushed", op: "create", as: subject.as, kind, name: subject.name, parent: "root", via: "push", source: subject.source })
  if (call) {
    steps.push({ op: "find", as: "main", name: "PLC_PRG" })
    steps.push({ vendor: "codesys", tag: "called", op: "setText", on: "main", via: "script", impl: call + "\n" })
    steps.push({ vendor: "twincat", tag: "called", op: "setText", on: "main", via: "push", after: { line: "%LANGUAGE ST", add: call } })
  }
  steps.push({ tag: "built", op: "build" }, { tag: "reloaded", op: "reload" }, { tag: "rebuilt", op: "build" })
  return steps
}

/** An `nwl` read of `on` at every moment of `nwlSteps` keeping `members`, the pull's text after the push and the
 *  reopen, and both builds' messages. */
function nwlReads(on: string | string[], members: string[]): Read[] {
  return [
    { key: "nwl", at: ["pushed", "built", "reloaded", "rebuilt"], on, op: "nwl", members },
    { key: "fetched", at: ["pushed", "reloaded"], on, op: "fetched" },
    { key: "diagnostics", at: ["built", "rebuilt"], op: "diagnostics" },
  ]
}

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

/** The text-list enum edit row's four moments (openspec `bridge-one-to-one` gate 1). */
const EDITS = ["created", "removed", "renamed", "reloaded"] as const

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
        after: { line: "%LANGUAGE ST", add: "VltF_SubUse();" },
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
          "VltF_Seed_F(n) EN go\n  ok := ENO;",
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
        source: SRC.caller("VltF_Seed_PE", "LD", "\tgo : BOOL;\n\tdone : BOOL;", "VltF_Seed_P() EN go\n  done := ENO;"),
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
          "b() EN go\n  done := ENO;",
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
      // scripting, `updated`), and — since `abstract-member-push` (the pull states no `%LANGUAGE` line for it and the
      // push writes no body there) — a line added beside it in its OWNER's pulled text, through the shipped push (`pushed`).
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
      // declared and holding null, which is what the driver states as no body slot (no `%LANGUAGE` line).
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
        on: [
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
    // C2n, both vendors (openspec `abstract-member-parity` 1.1–1.3): an abstract member that HOLDS code — does the build
    // refuse it, and with what message (1.1)? What the shipped bridge's fetch answers for an abstract member's owner —
    // TwinCAT's (never recorded before) and a script-made CODESYS one (1.2, 1.3)? Whether an empty body written at a
    // TwinCAT abstract member's slot survives save/reopen (1.2), and what class and slot a CODESYS `create_method`
    // given ABSTRACT text has (1.3). A non-abstract derived FB overrides both members and a program instantiates it, so
    // the build compiles the base whatever the vendor does with an unused POU; each build is preceded by a control build
    // of the same members with EMPTY bodies.
    id: "abstract-member-code",
    dialect: ["C2n"],
    vendors: { codesys: true, twincat: true },
    steps: [
      // ── CODESYS: everything through scripting, on a fresh fixture copy (PLC_PRG is rewritten).
      { vendor: "codesys", op: "open", fixture: "CodesysTestProject" },
      {
        vendor: "codesys",
        op: "create",
        as: "fb",
        kind: "function_block",
        name: "VltA_CodeBase",
        parent: "root",
        via: "script",
        decl: "FUNCTION_BLOCK ABSTRACT VltA_CodeBase\nVAR\nEND_VAR\n",
      },
      {
        vendor: "codesys",
        tag: "script-made",
        op: "create",
        as: "method",
        kind: "method",
        name: "Pick",
        parent: "fb",
        via: "script",
        decl: "METHOD ABSTRACT Pick : INT\n",
      },
      {
        vendor: "codesys",
        op: "create",
        as: "prop",
        kind: "property",
        name: "Busy",
        parent: "fb",
        via: "script",
        decl: "PROPERTY ABSTRACT Busy : INT\n",
      },
      { vendor: "codesys", op: "find", as: "set", name: "Set", under: "prop" },
      { vendor: "codesys", tag: "property-made", op: "find", as: "get", name: "Get", under: "prop" },
      {
        vendor: "codesys",
        op: "create",
        as: "impl",
        kind: "function_block",
        name: "VltA_CodeImpl",
        parent: "root",
        via: "script",
        decl: "FUNCTION_BLOCK VltA_CodeImpl EXTENDS VltA_CodeBase\nVAR\nEND_VAR\n",
      },
      {
        vendor: "codesys",
        op: "create",
        as: "implpick",
        kind: "method",
        name: "Pick",
        parent: "impl",
        via: "script",
        decl: "METHOD Pick : INT\n",
        impl: "Pick := 2;\n",
      },
      {
        vendor: "codesys",
        op: "create",
        as: "implprop",
        kind: "property",
        name: "Busy",
        parent: "impl",
        via: "script",
        decl: "PROPERTY Busy : INT\n",
      },
      { vendor: "codesys", op: "find", as: "implget", name: "Get", under: "implprop" },
      { vendor: "codesys", op: "setText", on: "implget", via: "script", impl: "Busy := 2;\n" },
      { vendor: "codesys", op: "find", as: "main", name: "PLC_PRG" },
      {
        vendor: "codesys",
        op: "setText",
        on: "main",
        via: "script",
        decl: "PROGRAM PLC_PRG\nVAR\n\tf : VltA_CodeImpl;\n\tx : INT;\nEND_VAR\n",
        impl: "x := f.Pick() + f.Busy;\n",
      },
      // ── TwinCAT: the base made by the shipped push in the shape Volt writes (a property's GET is made only so, C2n),
      // one abstract method made through the vendor API beside it, the derived FB and its user by push.
      {
        vendor: "twincat",
        op: "create",
        as: "sfb",
        kind: "function_block",
        name: "VltA_CodeScript",
        parent: "root",
        via: "script",
        decl: "FUNCTION_BLOCK ABSTRACT VltA_CodeScript\nVAR\nEND_VAR\n",
      },
      {
        vendor: "twincat",
        tag: "script-made",
        op: "create",
        as: "smethod",
        kind: "method",
        name: "Pick",
        parent: "sfb",
        via: "script",
        decl: "METHOD ABSTRACT Pick : INT\n",
      },
      {
        vendor: "twincat",
        op: "create",
        as: "fb",
        kind: "function_block",
        name: "VltA_CodeBase",
        parent: "root",
        via: "push",
        source:
          `FUNCTION_BLOCK ABSTRACT VltA_CodeBase\nVAR\n\tx : INT;\nEND_VAR\n${MARK}\nx := x + 1;\n\nEND_FUNCTION_BLOCK\n` +
          `\nMETHOD ABSTRACT Pick : INT\n${MARK}\n\nEND_METHOD\n` +
          `\nPROPERTY ABSTRACT Busy : INT\nGET\n${MARK}\n\nEND_GET\nSET\n${MARK}\n\nEND_SET\nEND_PROPERTY\n`,
      },
      { vendor: "twincat", op: "find", as: "method", name: "Pick", under: "fb" },
      { vendor: "twincat", op: "find", as: "prop", name: "Busy", under: "fb" },
      { vendor: "twincat", op: "find", as: "set", name: "Set", under: "prop" },
      { vendor: "twincat", tag: "property-made", op: "find", as: "get", name: "Get", under: "prop" },
      {
        vendor: "twincat",
        op: "create",
        as: "impl",
        kind: "function_block",
        name: "VltA_CodeImpl",
        parent: "root",
        via: "push",
        source:
          `FUNCTION_BLOCK VltA_CodeImpl EXTENDS VltA_CodeBase\nVAR\n\ty : INT;\nEND_VAR\n${MARK}\ny := y + 1;\n\nEND_FUNCTION_BLOCK\n` +
          `\nMETHOD Pick : INT\n${MARK}\nPick := 2;\nEND_METHOD\n` +
          `\nPROPERTY Busy : INT\nGET\n${MARK}\nBusy := 2;\nEND_GET\nSET\n${MARK}\n\nEND_SET\nEND_PROPERTY\n`,
      },
      { vendor: "twincat", op: "find", as: "implpick", name: "Pick", under: "impl" },
      // The derived FB used from the program the PLC task calls: a first run with a program of its own that no task
      // called reported nothing, not even the control below (the build did not compile what no task reaches). The push
      // side restores PLC_PRG's text at cleanup.
      { vendor: "twincat", op: "find", as: "main", name: "PLC_PRG" },
      {
        vendor: "twincat",
        op: "setText",
        on: "main",
        via: "push",
        after: { line: "VAR", add: "    vltA : VltA_CodeImpl;\n    vltX : INT;" },
      },
      {
        vendor: "twincat",
        op: "setText",
        on: "main",
        via: "push",
        after: { line: "// Drive the PackML unit", add: "vltX := vltA.Pick() + vltA.Busy;" },
      },
      // ── both: a control build (empty abstract bodies), then code at the abstract method's slot, then at the GET's.
      { tag: "empty-built", op: "build" },
      // The control that the build COMPILES these POUs: an unknown name in the derived method's body must be reported
      // (a first TwinCAT run whose caller no task reached answered the code under the abstract members, AND this
      // control, with no message at all).
      { op: "setText", on: "implpick", via: "script", impl: "Pick := VltA_NoSuchName;\n" },
      { tag: "control-built", op: "build" },
      { op: "setText", on: "implpick", via: "script", impl: "Pick := 2;\n" },
      { tag: "method-code", op: "setText", on: "method", via: "script", impl: "Pick := 1;\n" },
      { tag: "method-built", op: "build" },
      { op: "setText", on: "method", via: "script", impl: "" },
      { tag: "get-code", op: "setText", on: "get", via: "script", impl: "Busy := 1;\n" },
      { tag: "get-built", op: "build" },
      { op: "setText", on: "get", via: "script", impl: "" },
      // The SET accessor of the same abstract property (review: a GET fact is not carried over to the SET unmeasured).
      { tag: "set-code", op: "setText", on: "set", via: "script", impl: "Busy := 1;\n" },
      { tag: "set-built", op: "build" },
      { op: "setText", on: "set", via: "script", impl: "" },
      // A COMMENT-only body under the abstract method (a line comment) and the GET (a block comment), one build (gate-2
      // review: "must not contain any statements" — is a comment a statement? and what does the fetch show?).
      { op: "setText", on: "method", via: "script", impl: "// to be overridden\n" },
      { tag: "comment-made", op: "setText", on: "get", via: "script", impl: "(* to be overridden *)\n" },
      { tag: "comment-built", op: "build" },
      { op: "setText", on: "method", via: "script", impl: "" },
      // The code taken away again: an EMPTY body written at each slot, then saved, closed and reopened.
      { tag: "emptied", op: "setText", on: "get", via: "script", impl: "" },
      { tag: "saved", op: "reload" },
    ],
    reads: [
      // 1.1 — the build's messages: control, code under the abstract method, code under the abstract GET.
      {
        key: "diagnostics",
        at: ["empty-built", "control-built", "method-built", "get-built", "set-built", "comment-built"],
        op: "diagnostics",
        mentioning: "VltA_",
      },
      // 1.2 / 1.3 — the owner's text as the shipped bridge fetches it (what `volt pull` writes) at every stage.
      {
        key: "fetched",
        at: ["property-made", "method-code", "get-code", "set-code", "comment-made", "emptied", "saved"],
        on: "fb",
        op: "fetched",
      },
      { vendor: "twincat", key: "fetched-script", at: ["script-made", "saved"], on: "sfb", op: "fetched" },
      // The classes, and the body slot on each object.
      { vendor: "codesys", key: "class", at: ["script-made", "saved"], on: "method", op: "class" },
      { vendor: "codesys", key: "class", at: ["property-made", "saved"], on: ["prop", "get", "set"], op: "class" },
      {
        vendor: "codesys",
        key: "implementation",
        at: ["script-made", "saved"],
        on: "method",
        op: "member",
        path: "object.Implementation.$type",
      },
      {
        vendor: "codesys",
        key: "implementation",
        at: ["property-made", "saved"],
        on: ["prop", "get", "set"],
        op: "member",
        path: "object.Implementation.$type",
      },
      {
        vendor: "codesys",
        key: "body",
        at: ["method-code", "get-code", "set-code", "comment-made", "emptied", "saved"],
        on: ["method", "get", "set"],
        op: "member",
        path: "script.textual_implementation.text",
      },
      {
        vendor: "codesys",
        key: "declaration",
        at: "saved",
        on: ["method", "prop"],
        op: "member",
        path: "script.textual_declaration.text",
      },
      { vendor: "twincat", key: "class", at: "property-made", on: ["fb", "method", "prop", "get", "set"], op: "class" },
      { vendor: "twincat", key: "class", at: "script-made", on: "smethod", op: "class" },
      {
        vendor: "twincat",
        key: "body",
        at: ["method-code", "get-code", "set-code", "comment-made", "emptied", "saved"],
        on: ["method", "get", "set"],
        op: "member",
        path: "item.ImplementationText",
      },
      // The body slot in the saved file after the empty writes.
      {
        vendor: "twincat",
        key: "file.method-st",
        at: "saved",
        on: "fb",
        op: "xml",
        file: true,
        xpath: "//Method[@Name='Pick']/Implementation/ST",
      },
      {
        vendor: "twincat",
        key: "file.get-st",
        at: "saved",
        on: "fb",
        op: "xml",
        file: true,
        xpath: "//Property[@Name='Busy']/Get/Implementation/ST",
      },
      {
        vendor: "twincat",
        key: "file.set-st",
        at: "saved",
        on: "fb",
        op: "xml",
        file: true,
        xpath: "//Property[@Name='Busy']/Set/Implementation/ST",
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
        after: { line: "%LANGUAGE ST", add: "VltF_LcFbd();\nVltF_LcSt();" },
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
  {
    // PLC Assist (2026-10-18, MultiProject): a `set` that renames AND moves into a new folder answered IDE_LOST_ITEM, the
    // IDE holding the item moved under its OLD name. TwinCAT's move is an export/delete/import of the item's document
    // (D4f): does a rename made just before it travel, and does a save between them, or the reverse order, change that?
    id: "tc-rename-then-move",
    dialect: ["D4f"],
    vendors: {
      twincat: true,
      codesys: { absent: "CODESYS moves the object itself (`move`), no document round trip: nothing of a rename can be left behind" },
    },
    steps: [
      { op: "create", as: "held", kind: "folder", name: "VltF_RmHeld", parent: "root", via: "script" },
      {
        op: "create",
        as: "p1",
        kind: "program",
        name: "VltF_Rm1",
        parent: "root",
        via: "script",
        decl: DECL.program("VltF_Rm1"),
      },
      {
        op: "create",
        as: "p2",
        kind: "program",
        name: "VltF_Rm2",
        parent: "root",
        via: "script",
        decl: DECL.program("VltF_Rm2"),
      },
      {
        op: "create",
        as: "p3",
        kind: "program",
        name: "VltF_Rm3",
        parent: "root",
        via: "script",
        decl: DECL.program("VltF_Rm3"),
      },
      {
        tag: "created",
        op: "create",
        as: "p4",
        kind: "program",
        name: "VltF_Rm4",
        parent: "root",
        via: "script",
        decl: DECL.program("VltF_Rm4"),
      },
      // (a) rename, then move into a folder created after the rename
      { op: "rename", on: "p1", to: "VltF_Rm1b", via: "script" },
      { op: "create", as: "new1", kind: "folder", name: "VltF_RmNew1", parent: "root", via: "script" },
      { tag: "renamed-moved-new", op: "move", on: "p1", to: "new1", via: "script" },
      // (b) rename, then move into a folder that was already there
      { op: "rename", on: "p2", to: "VltF_Rm2b", via: "script" },
      { tag: "renamed-moved-held", op: "move", on: "p2", to: "held", via: "script" },
      // (c) rename, save, then move into a new folder
      { op: "rename", on: "p3", to: "VltF_Rm3b", via: "script" },
      { op: "invoke", path: "dte.ExecuteCommand", args: ["File.SaveAll"] },
      { op: "create", as: "new3", kind: "folder", name: "VltF_RmNew3", parent: "root", via: "script" },
      { tag: "renamed-saved-moved", op: "move", on: "p3", to: "new3", via: "script" },
      // (d) move into a new folder, then rename
      { op: "create", as: "new4", kind: "folder", name: "VltF_RmNew4", parent: "root", via: "script" },
      { op: "move", on: "p4", to: "new4", via: "script" },
      { tag: "moved-renamed", op: "rename", on: "p4", to: "VltF_Rm4b", via: "script" },
    ],
    reads: [
      { key: "new1-children", at: "renamed-moved-new", on: "new1", op: "children" },
      { key: "held-children", at: "renamed-moved-held", on: "held", op: "children" },
      { key: "new3-children", at: "renamed-saved-moved", on: "new3", op: "children" },
      { key: "new4-children", at: "moved-renamed", on: "new4", op: "children" },
    ],
  },
  {
    // Volt never saves the IDE project (owner, 2026-10-18). No step of this row saves: a name is deleted and made
    // again, and a name is renamed onto one just deleted, all unsaved: does TwinCAT collide with what it left on disk?
    // Then the engineer's own save (`reload`: save, close, reopen) shows what the disk ends up holding.
    id: "tc-unsaved-name-reuse",
    dialect: ["D45"],
    vendors: {
      twincat: true,
      codesys: { absent: "CODESYS stores the project as one file it writes only on save: no per-object file to collide" },
    },
    steps: [
      { op: "create", as: "x1", kind: "program", name: "VltF_NsX", parent: "root", via: "script", decl: DECL.program("VltF_NsX") },
      { tag: "deleted", op: "delete", on: "x1", via: "script" },
      {
        tag: "recreated",
        op: "create",
        as: "x2",
        kind: "program",
        name: "VltF_NsX",
        parent: "root",
        via: "script",
        decl: "PROGRAM VltF_NsX\nVAR\n\tsecond : INT;\nEND_VAR\n",
        impl: "second := 2;\n",
      },
      {
        op: "create",
        as: "y",
        kind: "program",
        name: "VltF_NsY",
        parent: "root",
        via: "script",
        decl: "PROGRAM VltF_NsY\nVAR\n\tfromY : INT;\nEND_VAR\n",
        impl: "fromY := 3;\n",
      },
      { op: "create", as: "z", kind: "program", name: "VltF_NsZ", parent: "root", via: "script", decl: DECL.program("VltF_NsZ") },
      { op: "delete", on: "z", via: "script" },
      { tag: "renamed-onto-deleted", op: "rename", on: "y", to: "VltF_NsZ", via: "script" },
      { tag: "reloaded", op: "reload" },
    ],
    reads: [
      { key: "saved", at: ["deleted", "recreated", "renamed-onto-deleted"], op: "member", path: "dte.Solution.Saved" },
      {
        key: "decl.x2",
        at: ["recreated", "renamed-onto-deleted", "reloaded"],
        on: "x2",
        op: "member",
        path: "item.DeclarationText",
      },
      { key: "decl.y", at: ["renamed-onto-deleted", "reloaded"], on: "y", op: "member", path: "item.DeclarationText" },
      // What is on disk for each, unsaved and after the engineer's save.
      { key: "file.name.x2", at: ["recreated", "reloaded"], on: "x2", op: "xml", file: true, xpath: "//POU/@Name" },
      { key: "file.decl.x2", at: ["recreated", "reloaded"], on: "x2", op: "xml", file: true, xpath: "//POU/Declaration" },
      { key: "file.name.y", at: ["renamed-onto-deleted", "reloaded"], on: "y", op: "xml", file: true, xpath: "//POU/@Name" },
      {
        key: "file.decl.y",
        at: ["renamed-onto-deleted", "reloaded"],
        on: "y",
        op: "xml",
        file: true,
        xpath: "//POU/Declaration",
      },
      // What the shipped bridge reads (`volt pull`), unsaved and after the save.
      { key: "fetched", at: ["renamed-onto-deleted", "reloaded"], on: ["x2", "y"], op: "fetched" },
    ],
  },
  {
    // Does TwinCAT's build compile what the IDE holds IN MEMORY, unsaved? The bridge's build (which saves nothing) over
    // a new function, a new program that calls it, PLC_PRG calling that program (pushed, unsaved), then the program
    // changed to carry an error. `saved` says whether the solution was dirty before each build, and after it.
    id: "tc-unsaved-build",
    dialect: ["D45"],
    vendors: {
      twincat: true,
      codesys: { absent: "CODESYS compiles its live object model; it has no saved document a build could read instead" },
    },
    steps: [
      {
        op: "create",
        as: "f",
        kind: "function",
        name: "VltF_NbF",
        parent: "root",
        via: "script",
        decl: "FUNCTION VltF_NbF : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\n",
        impl: "VltF_NbF := a + 1;\n",
      },
      {
        op: "create",
        as: "u",
        kind: "program",
        name: "VltF_NbUse",
        parent: "root",
        via: "script",
        decl: "PROGRAM VltF_NbUse\nVAR\n\tr : INT;\nEND_VAR\n",
        impl: "r := VltF_NbF(1);\n",
      },
      { op: "find", as: "main", name: "PLC_PRG" },
      {
        tag: "called",
        op: "setText",
        on: "main",
        via: "push",
        after: { line: "%LANGUAGE ST", add: "VltF_NbUse();" },
      },
      { tag: "built", op: "build" },
      { tag: "broken", op: "setText", on: "u", via: "script", impl: "r := VltF_NbF(1) + VltF_NbNoSuchName;\n" },
      { tag: "negative", op: "build" },
    ],
    reads: [
      { key: "saved", at: ["called", "built", "broken", "negative"], op: "member", path: "dte.Solution.Saved" },
      { key: "diagnostics", at: ["built", "negative"], op: "diagnostics", mentioning: "VltF_Nb" },
      // The changed body on disk before and after the build: did the build save it?
      { key: "file.impl", at: ["broken", "negative"], on: "u", op: "xml", file: true, xpath: "//POU/Implementation/ST" },
    ],
  },
  {
    // TwinCAT's move is an export / delete / import of the item's document (D4f). With no save anywhere: does a move
    // keep an unsaved text edit, a fresh unsaved item, a rename made AFTER the move, and a POU's members?
    id: "tc-unsaved-move",
    dialect: ["D4f", "D45"],
    vendors: {
      twincat: true,
      codesys: { absent: "CODESYS moves the object itself (`move`), no document round trip" },
    },
    steps: [
      { op: "create", as: "held", kind: "folder", name: "VltF_NmHeld", parent: "root", via: "script" },
      {
        op: "create",
        as: "p1",
        kind: "program",
        name: "VltF_Nm1",
        parent: "root",
        via: "script",
        decl: "PROGRAM VltF_Nm1\nVAR\n\tfirst : INT;\nEND_VAR\n",
        impl: "first := 1;\n",
      },
      {
        tag: "edited",
        op: "setText",
        on: "p1",
        via: "script",
        decl: "PROGRAM VltF_Nm1\nVAR\n\tedited : INT;\nEND_VAR\n",
        impl: "edited := 7;\n",
      },
      { tag: "edited-moved", op: "move", on: "p1", to: "held", via: "script" },
      {
        op: "create",
        as: "p2",
        kind: "program",
        name: "VltF_Nm2",
        parent: "root",
        via: "script",
        decl: "PROGRAM VltF_Nm2\nVAR\n\tfresh : INT;\nEND_VAR\n",
        impl: "fresh := 2;\n",
      },
      { tag: "created-moved", op: "move", on: "p2", to: "held", via: "script" },
      {
        op: "create",
        as: "p3",
        kind: "program",
        name: "VltF_Nm3",
        parent: "root",
        via: "script",
        decl: "PROGRAM VltF_Nm3\nVAR\n\tthird : INT;\nEND_VAR\n",
        impl: "third := 3;\n",
      },
      { op: "move", on: "p3", to: "held", via: "script" },
      { tag: "moved-renamed", op: "rename", on: "p3", to: "VltF_Nm3b", via: "script" },
      {
        op: "create",
        as: "fb",
        kind: "function_block",
        name: "VltF_NmFb",
        parent: "root",
        via: "script",
        decl: DECL.function_block("VltF_NmFb"),
      },
      {
        op: "create",
        as: "m",
        kind: "method",
        name: "Step",
        parent: "fb",
        via: "script",
        decl: "METHOD Step : INT\n",
        impl: "Step := 4;\n",
      },
      { tag: "member-moved", op: "move", on: "fb", to: "held", via: "script" },
      { tag: "reloaded", op: "reload" },
    ],
    reads: [
      { key: "saved", at: ["edited", "edited-moved", "member-moved"], op: "member", path: "dte.Solution.Saved" },
      { key: "decl.p1", at: ["edited", "edited-moved", "reloaded"], on: "p1", op: "member", path: "item.DeclarationText" },
      { key: "impl.p1", at: ["edited", "edited-moved", "reloaded"], on: "p1", op: "member", path: "item.ImplementationText" },
      { key: "decl.p2", at: ["created-moved", "reloaded"], on: "p2", op: "member", path: "item.DeclarationText" },
      { key: "impl.p2", at: ["created-moved", "reloaded"], on: "p2", op: "member", path: "item.ImplementationText" },
      { key: "decl.p3", at: ["moved-renamed", "reloaded"], on: "p3", op: "member", path: "item.DeclarationText" },
      {
        key: "held-children",
        at: ["edited-moved", "created-moved", "moved-renamed", "member-moved", "reloaded"],
        on: "held",
        op: "children",
      },
      { key: "fb-children", at: ["member-moved", "reloaded"], on: "fb", op: "children" },
      { key: "fetched", at: ["member-moved", "reloaded"], on: ["p1", "p2", "p3", "fb"], op: "fetched" },
    ],
  },
  {
    // What the shipped bridge READS of unsaved state: a text edit, a rename, and an interface whose property was made
    // in this session (its accessors' declarations are read from the saved file, D21).
    id: "tc-unsaved-read",
    dialect: ["D45"],
    vendors: {
      twincat: true,
      codesys: { absent: "CODESYS answers every read from its live object model" },
    },
    steps: [
      {
        op: "create",
        as: "p",
        kind: "program",
        name: "VltF_NrP",
        parent: "root",
        via: "script",
        decl: "PROGRAM VltF_NrP\nVAR\n\tbefore : INT;\nEND_VAR\n",
        impl: "before := 1;\n",
      },
      { tag: "created", op: "setText", on: "p", via: "script", impl: "before := 5;\n" },
      { tag: "renamed", op: "rename", on: "p", to: "VltF_NrQ", via: "script" },
      { op: "create", as: "itf", kind: "interface", name: "IVltF_NrI", parent: "root", via: "script" },
      { tag: "itf-made", op: "create", as: "prop", kind: "property", name: "Level", parent: "itf", via: "script" },
      { tag: "reloaded", op: "reload" },
    ],
    reads: [
      { key: "file.impl", at: ["created", "renamed"], on: "p", op: "xml", file: true, xpath: "//POU/Implementation/ST" },
      { key: "file.name.p", at: "renamed", on: "p", op: "xml", file: true, xpath: "//POU/@Name" },
      { key: "fetched.p", at: ["created", "renamed", "reloaded"], on: "p", op: "fetched" },
      { key: "file.itf", at: "itf-made", on: "itf", op: "xml", file: true, xpath: "//Itf/Property/@Name" },
      { key: "fetched.itf", at: ["itf-made", "reloaded"], on: "itf", op: "fetched" },
    ],
  },
  {
    // openspec `move-onto-existing-path-refused` 1.1: a rename or a move onto a name the IDE already holds, asked of the
    // vendor directly (no Volt gate) - refused, clash-renamed, or two objects - and which kinds share the name scope.
    id: "name-onto-taken",
    dialect: ["C38"],
    vendors: { codesys: true, twincat: true },
    steps: [
      { vendor: "codesys", op: "open", fixture: "CodesysTestProject" },
      { op: "create", as: "fa", kind: "folder", name: "VltF_TkA", parent: "root", via: "script" },
      { op: "create", as: "fb", kind: "folder", name: "VltF_TkB", parent: "root", via: "script" },
      {
        op: "create",
        as: "x",
        kind: "function_block",
        name: "VltF_TkX",
        parent: "fa",
        via: "script",
        decl: DECL.function_block("VltF_TkX"),
      },
      {
        op: "create",
        as: "y",
        kind: "function_block",
        name: "VltF_TkY",
        parent: "fa",
        via: "script",
        decl: DECL.function_block("VltF_TkY"),
      },
      {
        op: "create",
        as: "z",
        kind: "function_block",
        name: "VltF_TkZ",
        parent: "fb",
        via: "script",
        decl: DECL.function_block("VltF_TkZ"),
      },
      {
        op: "create",
        as: "d",
        kind: "dut",
        seed: "struct",
        name: "VltF_TkD",
        parent: "fa",
        via: "script",
        decl: DUT.struct("VltF_TkD"),
      },
      { op: "create", as: "g", kind: "gvl", name: "VltF_TkG", parent: "fa", via: "script" },
      {
        tag: "created",
        op: "create",
        as: "p",
        kind: "program",
        name: "VltF_TkP",
        parent: "fb",
        via: "script",
        decl: DECL.program("VltF_TkP"),
      },
      // (a) the same folder, the same kind; (b) another folder of the application.
      { tag: "same-folder", op: "rename", on: "y", to: "VltF_TkX", via: "script" },
      { tag: "other-folder", op: "rename", on: "z", to: "VltF_TkX", via: "script" },
      // Which kinds share the name scope with an FB: a DUT, a GVL, a program.
      { tag: "dut-onto-fb", op: "rename", on: "d", to: "VltF_TkX", via: "script" },
      { tag: "gvl-onto-fb", op: "rename", on: "g", to: "VltF_TkX", via: "script" },
      { tag: "prg-onto-fb", op: "rename", on: "p", to: "VltF_TkX", via: "script" },
      // (c) can the IDE hold a taken name in another folder at all - the state a move onto a held name needs?
      {
        tag: "create-other-folder",
        op: "create",
        as: "x2",
        kind: "function_block",
        name: "VltF_TkX",
        parent: "fb",
        via: "script",
        decl: DECL.function_block("VltF_TkX"),
      },
    ],
    reads: [
      {
        key: "fa-children",
        at: [
          "created",
          "same-folder",
          "other-folder",
          "dut-onto-fb",
          "gvl-onto-fb",
          "prg-onto-fb",
          "create-other-folder",
        ],
        on: "fa",
        op: "children",
      },
      {
        key: "fb-children",
        at: [
          "created",
          "same-folder",
          "other-folder",
          "dut-onto-fb",
          "gvl-onto-fb",
          "prg-onto-fb",
          "create-other-folder",
        ],
        on: "fb",
        op: "children",
      },
    ],
  },
  {
    // openspec `bridge-one-to-one` 1.3, proposal finding 1: can a create make each class Volt folds — through the
    // vendor's own factory or class, the way its Add Object does — and do the class, its special member and the text
    // survive a reload? A refused create is the vendor's answer, recorded. The text-list enum's rows after a
    // declaration write answer `textlist-enum-rows-derived` (design §1): rebuilt from the declaration, or not.
    id: "create-each-class",
    dialect: ["C2r"],
    vendors: {
      codesys: true,
      twincat: {
        absent:
          "TwinCAT's special classes are `tc-special-classes`; it has no persistent-list, NVL or text-list-enum class (0 in its corpus, DIALECT C2n)",
      },
    },
    steps: [
      { op: "open", fixture: "CodesysTestProject" },
      {
        op: "create",
        as: "check",
        kind: "function",
        name: "CheckBounds",
        parent: "root",
        via: "script",
        vendorClass: "_3S.CoDeSys.POUObject.POUObjectCheckFunction",
        init: { KindOfCheckFunction: { enum: "_3S.CoDeSys.POUObject.CheckFunctionSelection.CheckBounds" } },
        decl: "FUNCTION CheckBounds : DINT\nVAR_INPUT\n\tindex, lower, upper : DINT;\nEND_VAR\n",
        impl: "IF index < lower THEN\n\tCheckBounds := lower;\nELSIF index > upper THEN\n\tCheckBounds := upper;\nELSE\n\tCheckBounds := index;\nEND_IF\n",
      },
      {
        op: "create",
        as: "pers",
        kind: "gvl",
        name: "VltF_Persistent",
        parent: "root",
        via: "script",
        factory: "_3S.CoDeSys.GVLObject.VarPersistentObjectFactory",
      },
      // A second persistent list in the same application.
      {
        op: "create",
        as: "pers2",
        kind: "gvl",
        name: "VltF_Persistent2",
        parent: "root",
        via: "script",
        factory: "_3S.CoDeSys.GVLObject.VarPersistentObjectFactory",
      },
      {
        op: "create",
        as: "tle",
        kind: "dut",
        name: "VltF_TextEnum",
        parent: "root",
        via: "script",
        factory: "_3S.CoDeSys.TextList.TextListEnumerationObjectFactory",
        decl: "TYPE VltF_TextEnum :\n(\n\tRed := 0,\n\tGreen := 5,\n\tBlue\n);\nEND_TYPE\n",
      },
      {
        op: "create",
        as: "sender",
        kind: "gvl",
        name: "VltF_Sender",
        parent: "root",
        via: "script",
        factory: "_3S.CoDeSys.GVLObject.SenderGVLObjectFactory",
      },
      {
        op: "create",
        as: "param",
        kind: "gvl",
        name: "VltF_Params",
        parent: "root",
        via: "script",
        factory: "_3S.CoDeSys.GVLObject.ParameterGVLObjectFactory",
      },
      {
        op: "create",
        as: "nvl",
        kind: "gvl",
        name: "VltF_Nvl",
        parent: "root",
        via: "script",
        factory: "_3S.CoDeSys.NVLObject.NVLObjectFactory",
      },
      {
        op: "create",
        as: "absfb",
        kind: "function_block",
        name: "VltF_AbsBase",
        parent: "root",
        via: "script",
        decl: "FUNCTION_BLOCK ABSTRACT VltF_AbsBase\nVAR\nEND_VAR\n",
      },
      {
        tag: "created",
        op: "create",
        as: "abs",
        kind: "method",
        name: "Pick",
        parent: "absfb",
        via: "script",
        vendorClass: "_3S.CoDeSys.MethodObject.AbstractPOUMethodObject",
        decl: "METHOD ABSTRACT Pick : INT\n",
      },
      { tag: "built", op: "build" },
      { tag: "reloaded", op: "reload" },
    ],
    reads: [
      {
        key: "class",
        at: ["created", "reloaded"],
        on: ["check", "pers", "tle", "sender", "param", "abs"],
        op: "class",
      },
      { key: "check-kind", at: ["created", "reloaded"], on: "check", op: "member", path: "object.KindOfCheckFunction" },
      { key: "parameter-list", at: "reloaded", on: ["sender", "param"], op: "member", path: "object.ParameterList" },
      {
        key: "netvar-properties",
        at: "reloaded",
        on: ["sender", "param"],
        op: "member",
        path: "object.NetVarProperties.$type",
      },
      {
        key: "netvar-protocol",
        at: "reloaded",
        on: "sender",
        op: "member",
        path: "object.NetVarProperties.ProtocolName",
      },
      // textlist-enum-rows-derived: the rows after the declaration write, and after a reload.
      {
        key: "textlist-rows",
        at: ["created", "reloaded"],
        on: "tle",
        op: "member",
        path: "object.TextListObject.TextList.$count",
      },
      {
        key: "textlist-row-0-id",
        at: ["created", "reloaded"],
        on: "tle",
        op: "member",
        path: 'object.TextListObject.TextList[0].GetSerializableValue("TextID")',
      },
      {
        key: "textlist-row-1-default",
        at: "reloaded",
        on: "tle",
        op: "member",
        path: 'object.TextListObject.TextList[1].GetSerializableValue("TextDefault")',
      },
      {
        key: "textlist-row-2-id",
        at: "reloaded",
        on: "tle",
        op: "member",
        path: 'object.TextListObject.TextList[2].GetSerializableValue("TextID")',
      },
      {
        key: "textlist-row-3-id",
        at: "reloaded",
        on: "tle",
        op: "member",
        path: 'object.TextListObject.TextList[3].GetSerializableValue("TextID")',
      },
      {
        key: "decl",
        at: "reloaded",
        on: ["check", "pers", "tle", "sender", "param", "abs"],
        op: "member",
        path: "script.textual_declaration.text",
      },
      {
        key: "implementation",
        at: "reloaded",
        on: ["check", "abs"],
        op: "member",
        path: "object.Implementation.$type",
      },
      { key: "diagnostics", at: "built", op: "diagnostics" },
      // What the shipped bridge pulls for each today (the fold the change removes).
      { key: "fetched", at: "reloaded", on: ["check", "pers", "tle", "sender", "param", "absfb"], op: "fetched" },
    ],
  },
  {
    // openspec `bridge-one-to-one` gate 1 (review): the text-list enum's rows after Volt's OWN edits — an enumerator
    // REMOVED and one RENAMED through the shipped push — and across a reload: are the rows rebuilt from the declaration
    // and nothing else kept, and does `RemovedTextListEntries` (which the design refuses when non-empty) fill? Every
    // row's TextID AND TextDefault, so the row-to-enumerator pairing is read whole, not one column per row.
    id: "textlist-enum-edit",
    dialect: ["C2r"],
    vendors: {
      codesys: true,
      twincat: { absent: "TwinCAT has no text-list-enum class (0 in its corpus, DIALECT C2n)" },
    },
    steps: [
      { op: "open", fixture: "CodesysTestProject" },
      {
        tag: "created",
        op: "create",
        as: "tle",
        kind: "dut",
        name: "VltF_TextEdit",
        parent: "root",
        via: "script",
        factory: "_3S.CoDeSys.TextList.TextListEnumerationObjectFactory",
        decl: "TYPE VltF_TextEdit :\n(\n\tRed := 0,\n\tGreen := 5,\n\tBlue\n);\nEND_TYPE\n",
      },
      {
        tag: "removed",
        op: "setText",
        on: "tle",
        via: "push",
        source: "TYPE VltF_TextEdit :\n(\n\tRed := 0,\n\tBlue\n);\nEND_TYPE\n",
      },
      {
        tag: "renamed",
        op: "setText",
        on: "tle",
        via: "push",
        source: "TYPE VltF_TextEdit :\n(\n\tRed := 0,\n\tCyan\n);\nEND_TYPE\n",
      },
      { tag: "reloaded", op: "reload" },
    ],
    reads: [
      { key: "rows", at: [...EDITS], on: "tle", op: "member", path: "object.TextListObject.TextList.$count" },
      {
        key: "removed-entries",
        at: [...EDITS],
        on: "tle",
        op: "member",
        path: 'object.GetSerializableValue("RemovedTextListEntries").$count',
      },
      ...[0, 1, 2, 3].flatMap((i): Read[] =>
        (["TextID", "TextDefault"] as const).map(
          (col): Read => ({
            key: `row-${i}-${col}`,
            at: [...EDITS],
            on: "tle",
            op: "member",
            path: `object.TextListObject.TextList[${i}].GetSerializableValue("${col}")`,
          }),
        ),
      ),
      {
        key: "removed-entries-items",
        at: "reloaded",
        on: "tle",
        op: "member",
        path: 'object.GetSerializableValue("RemovedTextListEntries")',
      },
      { key: "class", at: "reloaded", on: "tle", op: "class" },
      { key: "decl", at: "reloaded", on: "tle", op: "member", path: "script.textual_declaration.text" },
    ],
  },
  {
    // openspec `bridge-one-to-one` 1.3, proposal finding 2: is an `AbstractPOUMethodObject` the same thing to the
    // compiler as a `POUMethodObject` whose text says ABSTRACT? Both in one abstract FB, a derived FB that overrides
    // neither (then both), code under each, and the signatures. Equal = the class follows the text (no `%CLASS`).
    id: "abstract-member-equivalence",
    dialect: ["C2r"],
    vendors: {
      codesys: true,
      twincat: {
        absent: "TwinCAT has one method class (609); ABSTRACT is its text only (DIALECT C2n, abstract-member-slot)",
      },
    },
    steps: [
      { op: "open", fixture: "CodesysTestProject" },
      {
        op: "create",
        as: "base",
        kind: "function_block",
        name: "VltE_Base",
        parent: "root",
        via: "script",
        decl: "FUNCTION_BLOCK ABSTRACT VltE_Base\nVAR\nEND_VAR\n",
      },
      // A1: the scripting create (POUMethodObject) with ABSTRACT text; A2: the vendor's abstract class.
      {
        op: "create",
        as: "a1",
        kind: "method",
        name: "A1",
        parent: "base",
        via: "script",
        decl: "METHOD ABSTRACT A1 : INT\n",
      },
      {
        op: "create",
        as: "a2",
        kind: "method",
        name: "A2",
        parent: "base",
        via: "script",
        vendorClass: "_3S.CoDeSys.MethodObject.AbstractPOUMethodObject",
        decl: "METHOD ABSTRACT A2 : INT\n",
      },
      {
        op: "create",
        as: "derived",
        kind: "function_block",
        name: "VltE_Derived",
        parent: "root",
        via: "script",
        decl: "FUNCTION_BLOCK VltE_Derived EXTENDS VltE_Base\nVAR\nEND_VAR\n",
      },
      { op: "find", as: "main", name: "PLC_PRG" },
      {
        tag: "made",
        op: "setText",
        on: "main",
        via: "script",
        decl: "PROGRAM PLC_PRG\nVAR\n\td : VltE_Derived;\n\tx : INT;\nEND_VAR\n",
        impl: "d();\nx := d.A1() + d.A2();\n",
      },
      { tag: "missing", op: "build" },
      {
        op: "create",
        as: "o1",
        kind: "method",
        name: "A1",
        parent: "derived",
        via: "script",
        decl: "METHOD A1 : INT\n",
        impl: "A1 := 1;\n",
      },
      {
        op: "create",
        as: "o2",
        kind: "method",
        name: "A2",
        parent: "derived",
        via: "script",
        decl: "METHOD A2 : INT\n",
        impl: "A2 := 2;\n",
      },
      { tag: "implemented", op: "build" },
      // Code under the abstract member that has a body slot (A1; A2 has none).
      { tag: "a1-code", op: "setText", on: "a1", via: "script", impl: "A1 := 3;\n" },
      { tag: "a1-built", op: "build" },
    ],
    reads: [
      { key: "class", at: "made", on: ["a1", "a2"], op: "class" },
      { key: "implementation", at: "made", on: ["a1", "a2"], op: "member", path: "object.Implementation.$type" },
      { key: "signature", at: "implemented", on: ["a1", "a2"], op: "signature" },
      { key: "diagnostics", at: ["missing", "implemented", "a1-built"], op: "diagnostics" },
      { key: "fetched", at: "implemented", on: "base", op: "fetched" },
    ],
  },
  {
    // openspec `bridge-one-to-one` 1.3, proposal finding 1 on TwinCAT: does a TwinCAT POU carry a special class —
    // `SpecialFunc` in its file — and does a create named like a check function get one? Through the vendor API and
    // through the shipped push, saved and read back from the file and the automation XML.
    id: "tc-special-classes",
    dialect: ["C2s"],
    vendors: { twincat: true, codesys: { absent: "CODESYS's special classes are `create-each-class`" } },
    steps: [
      {
        op: "create",
        as: "scripted",
        kind: "function",
        name: "CheckBounds",
        parent: "root",
        via: "script",
        decl: "FUNCTION CheckBounds : DINT\nVAR_INPUT\n\tindex, lower, upper : DINT;\nEND_VAR\n",
        impl: "CheckBounds := index;\n",
      },
      {
        tag: "created",
        op: "create",
        as: "pushed",
        kind: "function",
        name: "CheckRangeSigned",
        parent: "root",
        via: "push",
        source: `FUNCTION CheckRangeSigned : DINT\nVAR_INPUT\n\tvalue, lower, upper : DINT;\nEND_VAR\n${MARK}\nCheckRangeSigned := value;\n\nEND_FUNCTION\n`,
      },
      { tag: "reloaded", op: "reload" },
    ],
    reads: [
      {
        key: "special-func",
        at: "reloaded",
        on: ["scripted", "pushed"],
        op: "xml",
        file: true,
        xpath: "/TcPlcObject/POU/@SpecialFunc",
      },
      { key: "automation-xml", at: "created", on: "scripted", op: "xml", xpath: "/TreeItem/*" },
      { key: "automation-pou-def", at: "created", on: "scripted", op: "xml", xpath: "/TreeItem/PlcPouDef/*" },
      { key: "item-type", at: "reloaded", on: ["scripted", "pushed"], op: "member", path: "item.ItemType" },
      { key: "fetched", at: "reloaded", on: "scripted", op: "fetched" },
    ],
  },
  {
    // openspec `bridge-one-to-one` 1.3, proposal finding 6 (DIALECT C2e): the shipped push creates every DUT on the 606
    // seed. After a reload: which tree code, the same object, the same text? (`dut-subtype-in-place` reads the codes;
    // this row adds identity and the pulled text across the reload.)
    id: "tc-dut-create-reload",
    dialect: ["C2e"],
    vendors: {
      twincat: true,
      codesys: {
        absent:
          "CODESYS creates every DUT `create_dut(Structure)` and its class carries no shape; the text decides it in the live session (C2e, C2g)",
      },
    },
    steps: [
      {
        op: "create",
        as: "e",
        kind: "dut",
        name: "VltF_CrEnum",
        parent: "root",
        via: "push",
        source: DUT.enum("VltF_CrEnum"),
      },
      {
        op: "create",
        as: "u",
        kind: "dut",
        name: "VltF_CrUnion",
        parent: "root",
        via: "push",
        source: DUT.union("VltF_CrUnion"),
      },
      {
        op: "create",
        as: "a",
        kind: "dut",
        name: "VltF_CrAlias",
        parent: "root",
        via: "push",
        source: DUT.alias("VltF_CrAlias"),
      },
      {
        tag: "created",
        op: "create",
        as: "s",
        kind: "dut",
        name: "VltF_CrStruct",
        parent: "root",
        via: "push",
        source: DUT.struct("VltF_CrStruct"),
      },
      { tag: "reloaded", op: "reload" },
    ],
    reads: [
      { key: "item-type", at: ["created", "reloaded"], on: ["e", "u", "a", "s"], op: "member", path: "item.ItemType" },
      { key: "guid", at: ["created", "reloaded"], on: ["e", "u", "a", "s"], op: "guid" },
      { key: "fetched", at: ["created", "reloaded"], on: ["e", "u", "a", "s"], op: "fetched" },
    ],
  },
  {
    // openspec `bridge-one-to-one` 1.3, proposal finding 7 (DIALECT D21): what a TwinCAT interface property's accessors
    // hold as a declaration — read from the saved FILE, never over COM (D21: the accessor's DeclarationText crashes
    // TcXaeShell) — and what the shipped bridge pulls for it.
    id: "tc-itf-accessor-decl",
    dialect: ["D21"],
    vendors: {
      twincat: true,
      codesys: { absent: "CODESYS's interface accessor declaration is `interface-accessor-write` (D41)" },
    },
    steps: [
      {
        tag: "created",
        op: "create",
        as: "itf",
        kind: "interface",
        name: "IVltF_AccDecl",
        parent: "root",
        via: "push",
        source:
          "INTERFACE IVltF_AccDecl\n\nPROPERTY P : INT\nGET\nEND_GET\nSET\nEND_SET\nEND_PROPERTY\nEND_INTERFACE\n",
      },
      { tag: "reloaded", op: "reload" },
    ],
    reads: [
      {
        key: "file.get",
        at: "reloaded",
        on: "itf",
        op: "xml",
        file: true,
        xpath: "//Property[@Name='P']/Get/Declaration",
      },
      {
        key: "file.set",
        at: "reloaded",
        on: "itf",
        op: "xml",
        file: true,
        xpath: "//Property[@Name='P']/Set/Declaration",
      },
      {
        key: "file.get-elements",
        at: "reloaded",
        on: "itf",
        op: "xml",
        file: true,
        xpath: "//Property[@Name='P']/Get/*",
      },
      { key: "fetched", at: ["created", "reloaded"], on: "itf", op: "fetched" },
    ],
  },
  {
    // openspec `bridge-one-to-one` 1.3 (proposal 9): does the vendor keep the ORDER members were created in — a pull
    // re-sorts them today — across a save and reopen?
    id: "member-order",
    dialect: ["C34"],
    vendors: { codesys: true, twincat: true },
    steps: [
      { vendor: "codesys", op: "open", fixture: "CodesysTestProject" },
      {
        op: "create",
        as: "fb",
        kind: "function_block",
        name: "VltF_Order",
        parent: "root",
        via: "script",
        decl: "FUNCTION_BLOCK VltF_Order\nVAR\n\tx : INT;\nEND_VAR\n",
      },
      {
        op: "create",
        as: "m1",
        kind: "method",
        name: "Zeta",
        parent: "fb",
        via: "script",
        decl: "METHOD Zeta : INT\n",
      },
      { op: "create", as: "m2", kind: "action", name: "Mid", parent: "fb", via: "script" },
      {
        op: "create",
        as: "m3",
        kind: "method",
        name: "Alpha",
        parent: "fb",
        via: "script",
        decl: "METHOD Alpha : INT\n",
      },
      // The type named on both vendors: TwinCAT's 611 takes its vInfo as the property's TYPE, and the driver's own
      // vInfo (the body language) made `PROPERTY PUBLIC Beta : ST` (bridge-one-to-one gate 1).
      {
        tag: "created",
        op: "create",
        as: "m4",
        kind: "property",
        name: "Beta",
        parent: "fb",
        via: "script",
        dataType: "INT",
      },
      { tag: "reloaded", op: "reload" },
    ],
    reads: [
      { key: "children", at: ["created", "reloaded"], on: "fb", op: "children" },
      { key: "fetched", at: "reloaded", on: "fb", op: "fetched" },
    ],
  },
  {
    // openspec `bridge-one-to-one` 1.3 (proposal 9): the order of a folder's items as created (not alphabetical), across
    // a save and reopen.
    id: "folder-order",
    dialect: ["C34"],
    vendors: { codesys: true, twincat: true },
    steps: [
      { vendor: "codesys", op: "open", fixture: "CodesysTestProject" },
      { op: "create", as: "folder", kind: "folder", name: "VltF_OrderDir", parent: "root", via: "script" },
      {
        op: "create",
        as: "z",
        kind: "program",
        name: "VltF_Zed",
        parent: "folder",
        via: "script",
        decl: DECL.program("VltF_Zed"),
      },
      {
        op: "create",
        as: "a",
        kind: "program",
        name: "VltF_Abc",
        parent: "folder",
        via: "script",
        decl: DECL.program("VltF_Abc"),
      },
      { op: "create", as: "sub", kind: "folder", name: "VltF_Sub", parent: "folder", via: "script" },
      {
        tag: "created",
        op: "create",
        as: "m",
        kind: "program",
        name: "VltF_Mid",
        parent: "folder",
        via: "script",
        decl: DECL.program("VltF_Mid"),
      },
      { tag: "reloaded", op: "reload" },
    ],
    reads: [{ key: "children", at: ["created", "reloaded"], on: "folder", op: "children" }],
  },
  {
    // openspec `bridge-one-to-one` 1.3 (proposal 8/9): does the vendor keep a declaration's and a body's TRAILING
    // newlines (Volt trims them) — and a text with none — across a save and reopen?
    id: "trailing-newline-cache",
    dialect: ["C35"],
    vendors: { codesys: true, twincat: true },
    steps: [
      { vendor: "codesys", op: "open", fixture: "CodesysTestProject" },
      {
        op: "create",
        as: "p",
        kind: "program",
        name: "VltF_Trail",
        parent: "root",
        via: "script",
        decl: "PROGRAM VltF_Trail\nVAR\n\tx : INT;\nEND_VAR\n\n\n",
        impl: "x := 1;\n\n\n",
      },
      {
        tag: "written",
        op: "create",
        as: "q",
        kind: "program",
        name: "VltF_NoTrail",
        parent: "root",
        via: "script",
        decl: "PROGRAM VltF_NoTrail\nVAR\n\tx : INT;\nEND_VAR",
        impl: "x := 1;",
      },
      { tag: "reloaded", op: "reload" },
    ],
    reads: [
      {
        vendor: "codesys",
        key: "decl",
        at: ["written", "reloaded"],
        on: ["p", "q"],
        op: "member",
        path: "script.textual_declaration.text",
      },
      {
        vendor: "codesys",
        key: "impl",
        at: ["written", "reloaded"],
        on: ["p", "q"],
        op: "member",
        path: "script.textual_implementation.text",
      },
      {
        vendor: "twincat",
        key: "decl",
        at: ["written", "reloaded"],
        on: ["p", "q"],
        op: "member",
        path: "item.DeclarationText",
      },
      {
        vendor: "twincat",
        key: "impl",
        at: ["written", "reloaded"],
        on: ["p", "q"],
        op: "member",
        path: "item.ImplementationText",
      },
      { key: "fetched", at: "reloaded", on: ["p", "q"], op: "fetched" },
    ],
  },
  {
    // openspec `bridge-one-to-one` 1.3, proposal finding 4: a DISABLED watchdog's time, UNIT and sensitivity — kept
    // behind the flag across a save and reopen (CODESYS)? The unit is a non-default one (µs, 4 of 13 corpus tasks), so a
    // fold to the default would show (gate 1). The fixture's own task, as found, is the corpus's empty-time case (CTP).
    // TwinCAT: which members a task's TaskDef holds at all.
    id: "watchdog-off-values",
    dialect: ["C36"],
    vendors: { codesys: true, twincat: true },
    steps: [
      { vendor: "codesys", op: "open", fixture: "CodesysTestProject" },
      { vendor: "codesys", tag: "found", op: "find", as: "task", name: "MainTask" },
      { vendor: "codesys", op: "invoke", on: "task", path: "script.watchdog.enabled", set: true },
      { vendor: "codesys", op: "invoke", on: "task", path: "script.watchdog.time", set: "123" },
      { vendor: "codesys", op: "invoke", on: "task", path: "script.watchdog.time_unit", set: "µs" },
      { vendor: "codesys", op: "invoke", on: "task", path: "script.watchdog.sensitivity", set: "3" },
      { vendor: "codesys", tag: "disabled", op: "invoke", on: "task", path: "script.watchdog.enabled", set: false },
      { vendor: "codesys", tag: "reloaded", op: "reload" },
      { vendor: "twincat", tag: "found", op: "find", as: "sys", name: "PlcTask", under: "tree:TIRT" },
    ],
    reads: [
      {
        vendor: "codesys",
        key: "watchdog-enabled",
        at: ["found", "disabled", "reloaded"],
        on: "task",
        op: "member",
        path: "script.watchdog.enabled",
      },
      {
        vendor: "codesys",
        key: "watchdog-time",
        at: ["found", "disabled", "reloaded"],
        on: "task",
        op: "member",
        path: "script.watchdog.time",
      },
      {
        vendor: "codesys",
        key: "watchdog-time-unit",
        at: ["found", "disabled", "reloaded"],
        on: "task",
        op: "member",
        path: "script.watchdog.time_unit",
      },
      {
        vendor: "codesys",
        key: "watchdog-sensitivity",
        at: ["found", "disabled", "reloaded"],
        on: "task",
        op: "member",
        path: "script.watchdog.sensitivity",
      },
      { vendor: "twincat", key: "taskdef", at: "found", on: "sys", op: "xml", xpath: "/TreeItem/TaskDef/*" },
    ],
  },
  {
    // openspec `bridge-one-to-one` 1.3, proposal finding 7: does TwinCAT state a library reference's SYSTEM flag (the
    // driver hard-codes false; CODESYS reads `SystemLibrary`, 142 true of 264)?
    id: "tc-library-system",
    dialect: ["C37"],
    vendors: {
      twincat: true,
      codesys: {
        absent: "CODESYS reads `SystemLibrary` on every library-manager item (census, design §0.1 finding 8)",
      },
    },
    // Gate 1: every placeholder the fixture references — Tc2_System and Tc3_Module too, the libraries TwinCAT itself
    // treats as system — read whole (the PlcLibPlaceholder and VSProperties subtrees, not their `<…>` summary), and the
    // system xpath run on EACH placeholder's own XML, not only on the References node's.
    steps: [
      { op: "find", as: "references", name: "References" },
      { op: "find", as: "standard", name: "Tc2_Standard", under: "references" },
      { op: "find", as: "system", name: "Tc2_System", under: "references" },
      { tag: "found", op: "find", as: "module", name: "Tc3_Module", under: "references" },
    ],
    reads: [
      { key: "references-xml", at: "found", on: "references", op: "xml", xpath: "/TreeItem/*" },
      { key: "children", at: "found", on: "references", op: "children" },
      { key: "library-xml", at: "found", on: "standard", op: "xml", xpath: "/TreeItem/*" },
      {
        key: "placeholder-reference",
        at: "found",
        on: "standard",
        op: "xml",
        xpath: "/TreeItem/PlcLibPlaceholder/PlaceholderReference/*",
      },
      {
        key: "placeholder-subtree",
        at: "found",
        on: ["standard", "system", "module"],
        op: "xml",
        xpath: "/TreeItem/PlcLibPlaceholder//*",
      },
      {
        key: "vs-properties",
        at: "found",
        on: ["standard", "system", "module"],
        op: "xml",
        xpath: "/TreeItem/VSProperties//*",
      },
      {
        key: "system-elements",
        at: "found",
        on: ["references", "standard", "system", "module"],
        op: "xml",
        xpath: "//*[contains(local-name(),'System')]",
      },
      {
        key: "system-attributes",
        at: "found",
        on: ["standard", "system", "module"],
        op: "xml",
        xpath: "//@*[contains(local-name(),'System')]",
      },
    ],
  },
  {
    // openspec `bridge-one-to-one` 1.3 (design §1 "caches"): the members the vendor keeps for its EDITOR — line-info
    // persistence, the per-object id counter, TwinCAT's LineIds — on an object made by the vendor API with no editor:
    // what it holds, whether the build takes the object as it is, and what a save and reopen leave. An object the
    // vendor builds without them, and that it fills itself, is a cache: Volt never spells or writes one.
    id: "editor-caches",
    dialect: ["C35"],
    vendors: { codesys: true, twincat: true },
    steps: [
      { vendor: "codesys", op: "open", fixture: "CodesysTestProject" },
      {
        tag: "made",
        op: "create",
        as: "p",
        kind: "program",
        name: "VltF_Cache",
        parent: "root",
        via: "script",
        decl: "PROGRAM VltF_Cache\nVAR\n\tx : INT;\nEND_VAR\n",
        impl: "x := x + 1;\n",
      },
      { tag: "built", op: "build" },
      { tag: "reloaded", op: "reload" },
    ],
    reads: [
      {
        vendor: "codesys",
        key: "decl-line-info",
        at: ["made", "reloaded"],
        on: "p",
        op: "member",
        path: 'object.Interface.TextDocument.GetSerializableValue("LineInfoPersistence").$type',
      },
      {
        vendor: "codesys",
        key: "impl-line-info",
        at: ["made", "reloaded"],
        on: "p",
        op: "member",
        path: 'object.Implementation.TextDocument.GetSerializableValue("LineInfoPersistence").$type',
      },
      {
        vendor: "codesys",
        key: "unique-id-generator",
        at: ["made", "reloaded"],
        on: "p",
        op: "member",
        path: 'object.GetSerializableValue("UniqueIdGenerator").$type',
      },
      {
        vendor: "codesys",
        key: "timestamp-type",
        at: "made",
        on: "p",
        op: "member",
        path: 'meta.GetSerializableValue("Timestamp").$type',
      },
      { vendor: "codesys", key: "diagnostics", at: "built", op: "diagnostics" },
      { vendor: "twincat", key: "diagnostics", at: "built", op: "diagnostics" },
      {
        vendor: "twincat",
        key: "file.line-ids",
        at: "reloaded",
        on: "p",
        op: "xml",
        file: true,
        xpath: "//LineIds/LineId/@*",
      },
      {
        vendor: "twincat",
        key: "file.elements",
        at: "reloaded",
        on: "p",
        op: "xml",
        file: true,
        xpath: "/TcPlcObject/POU/*",
      },
      { key: "fetched", at: "reloaded", on: "p", op: "fetched" },
    ],
  },
  {
    // ld-fbd-coverage 1b.4: can a body's network list keep ONE network untouched while its neighbours are inserted,
    // removed and rebuilt — through the shipped push, which pairs networks by text (NetworkPairing) — and what does the
    // kept network hold after save, close and reopen? Network #2 (`o2 := (a AND b);`) is read before the push (second) and
    // after it (third), beside the slot the push rebuilt (`o3 := b;` → `o4 := b;`, third → fourth): its item and network
    // `Id`s, and the members the IDE derives on a network Volt built (the target operand's `Type`, measured R in 1b.2) —
    // read on the body as Volt created it, after a build and a reload let the IDE fill them, and after the push.
    id: "nwl-keep-network-in-place",
    dialect: ["N28"],
    vendors: { codesys: true, twincat: true },
    steps: [
      { vendor: "codesys", op: "open", fixture: "CodesysTestProject" },
      { op: "create", as: "keep", kind: "program", name: "VltF_Keep", parent: "root", via: "push", source: keepSource(false) },
      { op: "find", as: "main", name: "PLC_PRG" },
      { vendor: "codesys", tag: "made", op: "setText", on: "main", via: "script", impl: "VltF_Keep();\n" },
      {
        vendor: "twincat",
        tag: "made",
        op: "setText",
        on: "main",
        via: "push",
        after: { line: "%LANGUAGE ST", add: "VltF_Keep();" },
      },
      { tag: "built-first", op: "build" },
      { tag: "reloaded-first", op: "reload" },
      { tag: "pushed", op: "setText", on: "keep", via: "push", source: keepSource(true) },
      { tag: "reloaded", op: "reload" },
      { tag: "built", op: "build" },
    ],
    reads: [
      {
        vendor: "codesys",
        key: "networks",
        at: ["made", "reloaded-first", "pushed", "reloaded"],
        on: "keep",
        op: "member",
        path: "object.Implementation.NetworkList.$count",
      },
      {
        vendor: "codesys",
        key: "kept.network-id",
        at: ["made", "built-first", "reloaded-first"],
        on: "keep",
        op: "member",
        path: "object.Implementation.GetNetwork(1).Id",
      },
      {
        vendor: "codesys",
        key: "kept.item-id",
        at: ["made", "built-first", "reloaded-first"],
        on: "keep",
        op: "member",
        path: "object.Implementation.GetNetwork(1).GetTree(0).Id",
      },
      {
        vendor: "codesys",
        key: "kept.target-type",
        at: ["made", "built-first", "reloaded-first"],
        on: "keep",
        op: "member",
        path: "object.Implementation.GetNetwork(1).GetTree(0).Outputs.List[0].Type",
      },
      {
        vendor: "codesys",
        key: "kept.network-id.third",
        at: ["pushed", "reloaded"],
        on: "keep",
        op: "member",
        path: "object.Implementation.GetNetwork(2).Id",
      },
      {
        vendor: "codesys",
        key: "kept.item-id.third",
        at: ["pushed", "reloaded"],
        on: "keep",
        op: "member",
        path: "object.Implementation.GetNetwork(2).GetTree(0).Id",
      },
      {
        vendor: "codesys",
        key: "kept.target-type.third",
        at: ["pushed", "reloaded", "built"],
        on: "keep",
        op: "member",
        path: "object.Implementation.GetNetwork(2).GetTree(0).Outputs.List[0].Type",
      },
      {
        vendor: "codesys",
        key: "rebuilt.item-id",
        at: ["made", "built-first", "reloaded-first"],
        on: "keep",
        op: "member",
        path: "object.Implementation.GetNetwork(2).GetTree(0).Id",
      },
      {
        vendor: "codesys",
        key: "rebuilt.target-type",
        at: ["made", "built-first", "reloaded-first"],
        on: "keep",
        op: "member",
        path: "object.Implementation.GetNetwork(2).GetTree(0).Outputs.List[0].Type",
      },
      {
        vendor: "codesys",
        key: "rebuilt.item-id.fourth",
        at: ["pushed", "reloaded"],
        on: "keep",
        op: "member",
        path: "object.Implementation.GetNetwork(3).GetTree(0).Id",
      },
      {
        vendor: "codesys",
        key: "rebuilt.target-type.fourth",
        at: ["pushed", "reloaded", "built"],
        on: "keep",
        op: "member",
        path: "object.Implementation.GetNetwork(3).GetTree(0).Outputs.List[0].Type",
      },
      {
        vendor: "codesys",
        key: "kept.target-boolean",
        at: ["made", "built-first", "reloaded-first"],
        on: "keep",
        op: "member",
        path: "object.Implementation.GetNetwork(1).GetTree(0).Outputs.List[0].Boolean",
      },
      {
        vendor: "codesys",
        key: "kept.target-boolean.third",
        at: ["pushed", "reloaded", "built"],
        on: "keep",
        op: "member",
        path: "object.Implementation.GetNetwork(2).GetTree(0).Outputs.List[0].Boolean",
      },
      {
        vendor: "codesys",
        key: "kept.box-fixed",
        at: ["made", "built-first", "reloaded-first"],
        on: "keep",
        op: "member",
        path: "object.Implementation.GetNetwork(1).GetTree(0).RValue.Flags.Fixed",
      },
      {
        vendor: "codesys",
        key: "kept.box-fixed.third",
        at: ["pushed", "reloaded", "built"],
        on: "keep",
        op: "member",
        path: "object.Implementation.GetNetwork(2).GetTree(0).RValue.Flags.Fixed",
      },
      {
        vendor: "codesys",
        key: "rebuilt.target-boolean",
        at: ["made", "built-first", "reloaded-first"],
        on: "keep",
        op: "member",
        path: "object.Implementation.GetNetwork(2).GetTree(0).Outputs.List[0].Boolean",
      },
      {
        vendor: "codesys",
        key: "rebuilt.target-boolean.fourth",
        at: ["pushed", "reloaded", "built"],
        on: "keep",
        op: "member",
        path: "object.Implementation.GetNetwork(3).GetTree(0).Outputs.List[0].Boolean",
      },
      {
        vendor: "twincat",
        key: "operands",
        at: ["made", "reloaded-first", "pushed", "reloaded"],
        on: "keep",
        op: "xml",
        file: true,
        xpath: "//l2[@n='NetworkList']/o//v[@n='Operand']",
      },
      {
        vendor: "twincat",
        key: "kept.ids",
        at: ["made", "built-first", "reloaded-first"],
        on: "keep",
        op: "xml",
        file: true,
        xpath: "//l2[@n='NetworkList']/o[2]//v[@n='Id']",
      },
      {
        vendor: "twincat",
        key: "kept.types",
        at: ["made", "built-first", "reloaded-first"],
        on: "keep",
        op: "xml",
        file: true,
        xpath: "//l2[@n='NetworkList']/o[2]//v[@n='Type']",
      },
      {
        vendor: "twincat",
        key: "kept.ids.third",
        at: ["pushed", "reloaded"],
        on: "keep",
        op: "xml",
        file: true,
        xpath: "//l2[@n='NetworkList']/o[3]//v[@n='Id']",
      },
      {
        vendor: "twincat",
        key: "kept.types.third",
        at: ["pushed", "reloaded", "built"],
        on: "keep",
        op: "xml",
        file: true,
        xpath: "//l2[@n='NetworkList']/o[3]//v[@n='Type']",
      },
      {
        vendor: "twincat",
        key: "rebuilt.ids",
        at: ["made", "built-first", "reloaded-first"],
        on: "keep",
        op: "xml",
        file: true,
        xpath: "//l2[@n='NetworkList']/o[3]//v[@n='Id']",
      },
      {
        vendor: "twincat",
        key: "rebuilt.ids.fourth",
        at: ["pushed", "reloaded"],
        on: "keep",
        op: "xml",
        file: true,
        xpath: "//l2[@n='NetworkList']/o[4]//v[@n='Id']",
      },
      {
        vendor: "twincat",
        key: "rebuilt.types.fourth",
        at: ["pushed", "reloaded", "built"],
        on: "keep",
        op: "xml",
        file: true,
        xpath: "//l2[@n='NetworkList']/o[4]//v[@n='Type']",
      },
      { key: "fetched", at: ["made", "pushed", "reloaded"], on: "keep", op: "fetched" },
      { key: "diagnostics", at: ["built-first", "built"], op: "diagnostics" },
    ],
  },
  // ── ld-fbd-coverage 2.2: the probe-table rows (design "1b.2"; the R rows: does the IDE fill a member a push did not
  // write, on a build or a reopen; the shape rows: what the push builds and the IDE holds) ──────────────────────────
  {
    id: "nwl-flags-fixed",
    dialect: ["N29"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "r", name: "VltF_R", source: NWL_R_BASE }),
    reads: nwlReads("r", ["Fixed"]),
  },
  {
    id: "nwl-operand-boolean",
    dialect: ["N29"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "r", name: "VltF_R", source: NWL_R_BASE }),
    reads: nwlReads("r", ["Boolean"]),
  },
  {
    id: "nwl-address-sentinel",
    dialect: ["N29"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "r", name: "VltF_R", source: NWL_R_BASE }),
    reads: nwlReads("r", ["Address"]),
  },
  {
    id: "nwl-branch-counter",
    dialect: ["N29"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "p", name: "VltF_RP", source: NWL_R_PAR }),
    reads: nwlReads("p", ["BranchCounter", "Mode"]),
  },
  {
    id: "nwl-item-id",
    dialect: ["N29"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "r", name: "VltF_R", source: NWL_R_BASE }),
    reads: nwlReads("r", ["Id"]),
  },
  {
    id: "nwl-bitop-stored-slot",
    dialect: ["N31"],
    vendors: { codesys: true, twincat: true },
    steps: [
      // CODESYS: the IDE-drawn stored form (pro2193 SetAlarm network 0, census 0.2) in its own project, and the plain
      // form the push builds beside it.
      { vendor: "codesys", op: "open", fixture: "Pro2193" },
      { vendor: "codesys", op: "find", as: "fb", name: "Cylinder_53ValveFB" },
      { vendor: "codesys", tag: "found", op: "find", as: "drawn", name: "SetAlarm", under: "fb" },
      { tag: "pushed", op: "create", as: "plain", kind: "program", name: "VltF_S1", parent: "root", via: "push", source: NWL_S1_PLAIN },
      { tag: "built", op: "build" },
      { tag: "reloaded", op: "reload" },
      { tag: "rebuilt", op: "build" },
    ],
    reads: [
      {
        vendor: "codesys",
        key: "drawn",
        at: ["found", "rebuilt"],
        on: "drawn",
        op: "nwl",
        members: ["BoxType", "CallType", "Names", "Types", "Names#count", "Types#count", "OutputItems#count", "EN", "ENO"],
      },
      { vendor: "codesys", key: "drawn.network-0", at: "found", on: "drawn", op: "nwl", network: 0, members: ["Operand"] },
      { vendor: "codesys", key: "drawn.fetched", at: "found", on: "fb", op: "fetched" },
      {
        vendor: "twincat",
        key: "drawn",
        at: "pushed",
        op: "absent",
        reason:
          "the TwinCAT-drawn AND boxes are the committed archive test/fixtures/TwinCAT Project14/…/Untitled2/POU_PBD.TcPOU " +
          "(its second PLC project, which this row's IDE does not serve): OutputParam Names [''] Types ['BOOL'], " +
          "OutputItems [null], EN/ENO false",
      },
      {
        key: "plain",
        at: ["pushed", "built", "reloaded", "rebuilt"],
        on: "plain",
        op: "nwl",
        members: ["BoxType", "CallType", "Names", "Types", "Names#count", "Types#count", "OutputItems#count", "EN", "ENO"],
      },
      { key: "plain.fetched", at: ["pushed", "reloaded"], on: "plain", op: "fetched" },
      { key: "diagnostics", at: ["built", "rebuilt"], op: "diagnostics" },
      {
        key: "run",
        at: "rebuilt",
        op: "absent",
        reason:
          "no row step runs code: whether the stored form and the plain form EXECUTE alike is not measured here " +
          "(the exec recorder's online simulation runs pushed text, and the stored form has no text to push)",
      },
    ],
  },
  {
    id: "nwl-leaf-wire-type",
    dialect: ["N32"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "lw", name: "VltF_Lw", source: NWL_LEAF_WIRE }, ["dintFn", "alias"]),
    reads: nwlReads("lw", ["Type", "Types", "Input", "VarId"]),
  },
  {
    id: "nwl-nested-assign",
    dialect: ["N34"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "s2", name: "VltF_S2", source: NWL_S2 }),
    reads: [
      ...nwlReads("s2", ["RValue", "InputItems", "Flags"]),
      {
        key: "drawn",
        at: "pushed",
        op: "absent",
        reason:
          "no committed fixture holds an IDE-drawn assign below the top level: the corpora's 6 networks are lenze-mid's " +
          "(SpeedCalculationDryer 0, Mach1_MIDS 7/29/52, Dryer 1, TrayFiller 30), recorded in nwl-corpus/lenze-mid.nwl.xml",
      },
    ],
  },
  {
    id: "nwl-rail-fed-wire",
    dialect: ["N33"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "rail", name: "VltF_Rail", source: NWL_RAIL }, [], [
      { as: "railTrue", name: "VltF_RailT", source: NWL_RAIL_TRUE },
    ]),
    reads: nwlReads(["rail", "railTrue"], ["Input", "VarId", "Operand"]),
  },
  {
    id: "nwl-input-pin-flag",
    dialect: ["N35"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "s6", name: "VltF_S6", source: NWL_S6 }, ["pinFb"]),
    reads: [
      ...nwlReads("s6", ["InputFlags", "Flags"]),
      {
        key: "drawn",
        at: "pushed",
        op: "absent",
        reason:
          "no committed fixture holds an IDE-drawn flag on a box input pin: the corpora's one network is lenze-mid's " +
          "(FirstErrorCapture.call_FirstErrorCapture_FB 8), recorded in nwl-corpus/lenze-mid.nwl.xml",
      },
    ],
  },
  {
    id: "nwl-super-call",
    dialect: ["N36"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "s5", name: "VltF_S5", source: NWL_S5, kind: "function_block" }, ["base"]),
    reads: [
      ...nwlReads("s5", ["BoxType", "CallType", "Operand"]),
      {
        key: "drawn",
        at: "pushed",
        op: "absent",
        reason:
          "no committed fixture holds an IDE-drawn SUPER^ call: the corpora's one network is lenze-mid's " +
          "(ATD_TorqueControl 0), recorded in nwl-corpus/lenze-mid.nwl.xml",
      },
    ],
  },
  {
    id: "nwl-operand-type",
    dialect: ["N30"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "r", name: "VltF_R", source: NWL_R_BASE }),
    reads: nwlReads("r", ["Type"]),
  },
  {
    id: "nwl-instance-type",
    dialect: ["N30"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "rc", name: "VltF_RC", source: NWL_R_CALLS }, ["fn", "prg"]),
    reads: nwlReads("rc", ["Type", "BoxType", "IsInstance"]),
  },
  {
    id: "nwl-param-types",
    dialect: ["N30"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "rc", name: "VltF_RC", source: NWL_R_CALLS }, ["fn", "prg"]),
    reads: nwlReads("rc", ["Names", "Types"]),
  },
  {
    id: "nwl-box-en-eno",
    dialect: ["N30"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "rc", name: "VltF_RC", source: NWL_R_CALLS }, ["fn", "prg"]),
    reads: nwlReads("rc", ["EN", "ENO", "BoxType"]),
  },
  {
    id: "nwl-input-flags-list",
    dialect: ["N30"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "r", name: "VltF_R", source: NWL_R_BASE }),
    reads: nwlReads("r", ["InputFlags", "BoxType"]),
  },
  {
    id: "nwl-output-param-names",
    dialect: ["N30"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "rc", name: "VltF_RC", source: NWL_R_CALLS }, ["fn", "prg"]),
    reads: nwlReads("rc", ["Names", "Names#count", "OutputItems#count", "BoxType", "CallType"]),
  },
  {
    id: "nwl-stsnippet-line-ids",
    dialect: ["N30"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "rx", name: "VltF_RX", source: NWL_R_EXEC }),
    reads: [
      ...nwlReads("rx", ["Id", "Tag", "Text", "TextLines", "CallType", "BoxType"]),
      {
        vendor: "codesys",
        key: "lines",
        at: ["pushed", "built", "reloaded", "rebuilt"],
        on: "rx",
        op: "member",
        path: "object.Implementation.GetNetwork(0).GetTree(0).STSnippet.Snippet.TextDocument.LineCount",
      },
      {
        vendor: "codesys",
        key: "line-id-0",
        at: ["pushed", "built", "reloaded", "rebuilt"],
        on: "rx",
        op: "member",
        path: "object.Implementation.GetNetwork(0).GetTree(0).STSnippet.Snippet.TextDocument.GetLineId(0)",
      },
      {
        vendor: "codesys",
        key: "line-id-1",
        at: ["pushed", "built", "reloaded", "rebuilt"],
        on: "rx",
        op: "member",
        path: "object.Implementation.GetNetwork(0).GetTree(0).STSnippet.Snippet.TextDocument.GetLineId(1)",
      },
      {
        vendor: "codesys",
        key: "line-tag-0",
        at: ["pushed", "built", "reloaded", "rebuilt"],
        on: "rx",
        op: "member",
        path: "object.Implementation.GetNetwork(0).GetTree(0).STSnippet.Snippet.TextDocument.GetLineTag(0)",
      },
      {
        vendor: "codesys",
        key: "snippet-id",
        at: ["pushed", "built", "reloaded", "rebuilt"],
        on: "rx",
        op: "member",
        path: "object.Implementation.GetNetwork(0).GetTree(0).STSnippet.Id",
      },
    ],
  },
  {
    id: "nwl-call-type",
    dialect: ["N30"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "rc", name: "VltF_RC", source: NWL_R_CALLS }, ["fn", "prg"]),
    reads: nwlReads("rc", ["CallType", "BoxType"]),
  },
  // ── ld-fbd-coverage 2R.1, check C1: does an IDE fill a box's OutputParam Names/Types — and the other members B7 must
  // drop, derive or refuse (Fixed, Boolean, Address, BranchCounter, EN/ENO, CallType) — itself, on opening the body in
  // its own editor, on a build, on a reopen, after a push wrote what it writes today? (B7: drop it if so.) ──
  {
    id: "nwl-editor-refill",
    dialect: ["N38"],
    vendors: { codesys: true, twincat: true },
    steps: [
      { vendor: "codesys", op: "open", fixture: "CodesysTestProject" },
      { op: "create", as: "callee_fn", kind: "function", name: "VltF_RFn", parent: "root", via: "push", source: NWL_CALLEE.fn },
      { op: "create", as: "rf", kind: "program", name: "VltF_RF", parent: "root", via: "push", source: NWL_EDITOR_FBD },
      { tag: "pushed", op: "create", as: "re", kind: "program", name: "VltF_RE", parent: "root", via: "push", source: NWL_EDITOR },
      { op: "find", as: "main", name: "PLC_PRG" },
      { vendor: "codesys", tag: "called", op: "setText", on: "main", via: "script", impl: "VltF_RE();\nVltF_RF();\n" },
      { vendor: "twincat", tag: "called", op: "setText", on: "main", via: "push", after: { line: "%LANGUAGE ST", add: "VltF_RE(); VltF_RF();" } },
      { op: "editor", on: "re" },
      { tag: "edited", op: "editor", on: "rf" },
      { tag: "built", op: "build" },
      { tag: "reloaded", op: "reload" },
      { op: "editor", on: "re" },
      { tag: "edited-again", op: "editor", on: "rf" },
      { tag: "rebuilt", op: "build" },
      { tag: "reloaded-again", op: "reload" },
    ],
    reads: [
      {
        key: "nwl",
        at: ["pushed", "edited", "built", "reloaded", "edited-again", "rebuilt", "reloaded-again"],
        on: "re",
        op: "nwl",
        members: NWL_EDITOR_MEMBERS,
      },
      {
        key: "nwl-fbd",
        at: ["pushed", "edited", "built", "reloaded", "edited-again", "rebuilt", "reloaded-again"],
        on: "rf",
        op: "nwl",
        members: NWL_EDITOR_MEMBERS,
      },
      { key: "fetched", at: ["pushed", "reloaded", "reloaded-again"], on: "re", op: "fetched" },
      { key: "fetched-fbd", at: ["pushed", "reloaded", "reloaded-again"], on: "rf", op: "fetched" },
      { key: "diagnostics", at: ["built", "rebuilt"], op: "diagnostics" },
    ],
  },
  {
    id: "nwl-assign-item-flags",
    dialect: ["N30"],
    vendors: { codesys: true, twincat: true },
    steps: nwlSteps({ as: "rj", name: "VltF_RJ", source: NWL_R_FLOW }),
    reads: nwlReads("rj", ["Flags", "Operand", "Label"]),
  },
]
