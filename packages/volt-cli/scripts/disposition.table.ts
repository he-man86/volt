/**
 * THE DISPOSITION TABLE AS DATA (openspec `bridge-one-to-one` design §1.1, made checkable for the completeness oracle
 * §2.1): every member of every vendor class Volt reads → what Volt does with it.
 *
 *   spelled   the member is Volt's text — its text form named; a push must reproduce it (`constant`: the one value
 *             measured on every occurrence — no line is spelled for it, and another value must refuse by name)
 *   cache     a MEASURED editor cache — the `vendor-facts` row that measured it; skipped only when that row exists
 *   identity  vendor-minted identity (a GUID, an id counter of the vendor's) — kept by an in-place write, new on a create
 *   refused   Volt has no text form for it — the pull or the push must refuse naming `name`
 *   scope     owned by another change (`ld-fbd-coverage`: NWL members inside a graphical body) — skipped, named
 *   measure   a cache CANDIDATE the oracle itself measures (design §1.1: `dymmattributecount`) — reported, never failed
 *
 * Member paths are the census's notation (design §0.1, what the cores' `archive` read answers): `meta.<member>`,
 * `meta.Properties[<property class>].<member>`, `<aspect>.<member>`, a list's `#count` and `[]` (an element: any index
 * or key reads as `[]`, except a property's class), `$class` the object's class; TwinCAT the file's
 * `<element>/@<attribute>` and `#text`, an element named by its `Name` attribute `Method[]`. A trailing `*` names every
 * member below a path. A member the table does not list is UNDECIDED: the oracle fails it by name.
 */

export type Vendor = "codesys" | "twincat"
export type Disposition =
  | { spelled: string; constant?: unknown }
  | { cache: string }
  | { identity: string }
  | { refused: string; name: string }
  | { scope: string }
  | { measure: string }
export type ClassTable = Readonly<Record<string, Disposition>>

const S = (spelled: string, constant?: unknown): Disposition =>
  constant === undefined ? { spelled } : { spelled, constant }
const CACHE = (row: string): Disposition => ({ cache: row })
const ID = (identity: string): Disposition => ({ identity })
const REFUSED = (name: string, refused: string): Disposition => ({ refused, name })

// ── CODESYS: the shared groups ──────────────────────────────────────────────────────────────────────────────────────

/** Every object's meta level (`IMetaObject`) and the object properties every source class may carry (design §1.1
 *  "Every object" and "Object properties"). */
const META: ClassTable = {
  $class: S("%CLASS / the kind (the file's extension, a member's keyword)"),
  "meta.Guid": ID("the object GUID — owner decision: unspelled; new on every create"),
  "meta.Name": S("the file / member name"),
  "meta.ParentGuid": S("the folder (file path; a member's %FOLDER)"),
  "meta.TypeGuid": S("derived from the class (%CLASS / the kind)"),
  "meta.EmbeddedTypeGuids*": S("derived from the class (%CLASS / the kind)"),
  "meta.Timestamp": CACHE("editor-caches"),
  "meta.Properties": S("the property lines (%CLASS … %FILE_LINK)"),
  "meta.Properties#count": S("the property lines (%CLASS … %FILE_LINK)"),
  "meta.Properties[]": S("the property lines (%CLASS … %FILE_LINK)"),
  "meta.Properties[SVFoldersProperty]*": S("the folder (file path; a member's %FOLDER)"),
  // The containing folders' GUIDs (measured by the oracle, 2026-10-13): a POU-internal folder a create re-makes is a
  // new object — the folder itself is spelled by its PATH.
  "meta.Properties[SVFoldersProperty].ParentObjects[]": ID(
    "the containing folders' GUIDs (the folder is spelled by its path)",
  ),
  "meta.Properties[BuildProperty]": S(
    "%EXCLUDE_FROM_BUILD … %UNDEFINE (the carrier is decided by 2.1: §1.2 'Presence of a defaulted carrier')",
  ),
  "meta.Properties[BuildProperty].ExcludeFromBuild": S("%EXCLUDE_FROM_BUILD"),
  "meta.Properties[BuildProperty].LinkAlways": S("%LINK_ALWAYS"),
  "meta.Properties[BuildProperty].External": S("%EXTERNAL"),
  "meta.Properties[BuildProperty].EnableSystemCall": S("%ENABLE_SYSTEM_CALL"),
  "meta.Properties[BuildProperty].MemoryReserveForOnlineChange": S("%ONLINE_CHANGE_RESERVE <n>"),
  "meta.Properties[BuildProperty].CompilerDefines": S("%COMPILER_DEFINES '…'"),
  "meta.Properties[BuildProperty].Undefines*": S("%UNDEFINE '…'"),
  "meta.Properties[DocumentationProperty]*": S("%COMMENT '…'"),
  "meta.Properties[FileLink]": S("%FILE_LINK <LinkType> '<path>'"),
  "meta.Properties[FileLink].LinkType": S("%FILE_LINK <LinkType> '<path>'"),
  "meta.Properties[FileLink].FileName": S("%FILE_LINK <LinkType> '<path>'"),
  // Design §1.1: "lTimeStamp: cache (the file's mtime)" — no vendor-facts row measures it yet, so the oracle names it.
  "meta.Properties[FileLink].lTimeStamp": CACHE("file-link-timestamp"),
  "meta.Properties[POUImageProperty]*": REFUSED("POUImageProperty", "a binary image has no text form"),
  "meta.Properties[SFCProperty]*": REFUSED(
    "SFC UNSUPPORTED",
    "SFCProperty belongs to the UNSUPPORTED SFC body and travels with it (the pull's line names it)",
  ),
  "meta.Properties[CFCProperty]*": REFUSED(
    "CFC UNSUPPORTED",
    "CFCProperty belongs to the UNSUPPORTED CFC body and travels with it (the pull's line names it)",
  ),
  "meta.Properties[SFCLibraryProperty]*": REFUSED(
    "SFC UNSUPPORTED",
    "SFCLibraryProperty belongs to the UNSUPPORTED SFC body",
  ),
  "meta.Properties[TransitionMonitoringProperty]*": REFUSED(
    "TransitionMonitoringProperty",
    "SFC: niche: accepted loss (0 occurrences in the corpora)",
  ),
  "meta.Properties[ActionObjectDuplicationModeProperty]*": REFUSED(
    "ActionObjectDuplicationModeProperty",
    "niche: accepted loss (0 occurrences in the corpora)",
  ),
  "meta.Properties[TransitionObjectDuplicationModeProperty]*": REFUSED(
    "TransitionObjectDuplicationModeProperty",
    "niche: accepted loss (0 occurrences in the corpora)",
  ),
  "meta.Properties[ObjectAccessProperty]*": REFUSED(
    "ObjectAccessProperty",
    "per-object access rights: niche: accepted loss (0 occurrences in the corpora)",
  ),
}

/** A member's meta level: its parent is its OWNER, whose identity a create of the item mints anew. */
const MEMBER_META: ClassTable = {
  ...META,
  "meta.ParentGuid": ID("the owner object (vendor-minted; a member's folder is %FOLDER)"),
}

/** A declaration aspect (`Interface`): the declaration text, verbatim. */
const DECLARATION: ClassTable = {
  Interface: S("the declaration"),
  "Interface.TextDocument": S("the declaration"),
  "Interface.TextDocument.Text": S("the declaration, verbatim (trailing newlines included: trailing-newline-cache)"),
  "Interface.TextDocument.LineInfoPersistence": CACHE("editor-caches"),
  // Measured by the oracle's first run (2026-10-13): null as the census read every object, the written TEXT after a
  // scripting write of the document — a serialization of the declaration, not yet a measured cache (no row).
  "Interface.TextDocument.TextBlobForSerialisation": CACHE("text-blob-serialisation"),
}

/** A body aspect (`Implementation`): its language (`%LANGUAGE <LANG>`) and, for ST, its text verbatim. A graphical
 *  body's own members are `ld-fbd-coverage`'s, and the core reads such a body as its class ALONE (`_OPAQUE_IMPL`) — so
 *  every member below `Implementation` is a TEXTUAL body's, and one not listed here is undecided (no wildcard: a
 *  `Implementation.*` scope entry matched exactly those ST members and skipped them as another change's). */
const BODY: ClassTable = {
  Implementation: S("the body's language (%LANGUAGE <LANG>)"),
  "Implementation.TextDocument": S("the body"),
  "Implementation.TextDocument.Text": S("the body, verbatim (trailing newlines included: trailing-newline-cache)"),
  "Implementation.TextDocument.LineInfoPersistence": CACHE("editor-caches"),
  "Implementation.TextDocument.TextBlobForSerialisation": CACHE("text-blob-serialisation"),
  "Implementation.ParameterInitializationMethodGenerator": S("measured null on every occurrence", null),
}

const UNIQUE_ID: ClassTable = { UniqueIdGenerator: CACHE("editor-caches") }

/** The vendor's NetVarProperties (a sender GVL's, or an NVL's imported ones under `prefix`). */
function netVar(prefix: string, line: string): ClassTable {
  const out: Record<string, Disposition> = { [prefix]: S(`${line} (present: the list is a network variable list)`) }
  for (const m of [
    "Acknowledge",
    "Checksum",
    "EventVariable",
    "ImportFileName",
    "Interval",
    "ListIdentifier",
    "MinimumGap",
    "PackVariables",
    "ProtocolName",
    "TaskName",
    "TransmitCyclic",
    "TransmitOnChange",
    "TransmitOnEvent",
  ])
    out[`${prefix}.${m}`] = S(`${line.replace("<member>", m)}`)
  out[`${prefix}.ProtocolParameterValues*`] = S(
    `${line.replace("<member>", "ProtocolParameterValues")} as <key>=<value> pairs`,
  )
  out[`${prefix}.GuidTaskStartSlot`] = ID("vendor-minted (a task slot)")
  out[`${prefix}.GuidTaskEndSlot`] = ID("vendor-minted (a task slot)")
  return out
}

const POU_MEMBERS: ClassTable = {
  POULevel: S("the one measured value (no line; another value refuses the item by name)", "Standard"),
  AddAttributeSubsequent: S("the one measured value (no line; true refuses by name)", false),
  ChildObjectGuids: S("measured empty on every occurrence"),
  "ChildObjectGuids#count": S("measured empty on every occurrence (non-empty refuses by name)", 0),
  "ChildObjectGuids[]": REFUSED("ChildObjectGuids", "measured empty on every occurrence"),
  SpecialFunc: S("%CLASS CHECK <SpecialFunc> (None: no line)"),
}

// ── CODESYS: the classes ────────────────────────────────────────────────────────────────────────────────────────────

const CODESYS: Record<string, ClassTable> = {
  "POUObject.POUObject": { ...META, ...DECLARATION, ...BODY, ...UNIQUE_ID, ...POU_MEMBERS },
  "POUObject.POUObjectCheckFunction": { ...META, ...DECLARATION, ...BODY, ...UNIQUE_ID, ...POU_MEMBERS },
  "MethodObject.POUMethodObject": { ...MEMBER_META, ...DECLARATION, ...BODY, ...UNIQUE_ID },
  "MethodObject.AbstractPOUMethodObject": { ...MEMBER_META, ...DECLARATION, ...UNIQUE_ID },
  "MethodObject.InterfaceMethodObject": { ...MEMBER_META, ...DECLARATION, ...UNIQUE_ID },
  "PropertyObject.PropertyObject": { ...MEMBER_META, ...DECLARATION, ...UNIQUE_ID },
  "PropertyObject.InterfacePropertyObject": { ...MEMBER_META, ...DECLARATION, ...UNIQUE_ID },
  "PropertyObject.PropertyAccessorObject": {
    ...MEMBER_META,
    ...DECLARATION,
    ...BODY,
    ...UNIQUE_ID,
    IsGet: S("the GET / SET keyword (read from IsGet: RefineAccessor's name rule deleted)"),
  },
  "PropertyObject.InterfacePropertyAccessorObject": {
    ...MEMBER_META,
    ...DECLARATION,
    ...UNIQUE_ID,
    IsGet: S("the GET / SET keyword (read from IsGet: RefineAccessor's name rule deleted)"),
  },
  "ActionObject.ActionObject": { ...MEMBER_META, ...BODY, ...UNIQUE_ID },
  "DUTObject.DUTObject": { ...META, ...DECLARATION, ...UNIQUE_ID },
  "TextList.TextListEnumerationObject": {
    ...META,
    ...DECLARATION,
    ...UNIQUE_ID,
    RemovedTextListEntries: S("measured empty (Volt's remove/rename never fills it: textlist-enum-edit)"),
    "RemovedTextListEntries#count": S("measured empty (non-empty refuses by name)", 0),
    "RemovedTextListEntries[]*": REFUSED("RemovedTextListEntries", "only the vendor's own text-list editor fills it"),
    TextListObject: S("%CLASS TEXTLIST_ENUM (its text list)"),
    "TextListObject.GuidInit": ID("vendor-minted"),
    "TextListObject.GuidReInit": ID("vendor-minted"),
    "TextListObject.GuidExitX": ID("vendor-minted"),
    "TextListObject.Languages": S("measured empty"),
    "TextListObject.Languages#count": S("measured empty (non-empty refuses by name)", 0),
    "TextListObject.Languages[]*": REFUSED("Languages", "a translated text Volt has no text form for"),
    "TextListObject.TextList": CACHE("textlist-enum-edit"),
    "TextListObject.TextList#count": CACHE("textlist-enum-edit"),
    "TextListObject.TextList[]": CACHE("textlist-enum-edit"),
    "TextListObject.TextList[].TextID": CACHE("textlist-enum-edit"),
    "TextListObject.TextList[].TextDefault": CACHE("textlist-enum-edit"),
    "TextListObject.TextList[].LanguageTexts": S("measured empty"),
    "TextListObject.TextList[].LanguageTexts#count": S("measured empty (non-empty refuses by name)", 0),
    "TextListObject.TextList[].LanguageTexts[]*": REFUSED(
      "LanguageTexts",
      "a translated text Volt has no text form for",
    ),
  },
  "InterfaceObject.InterfaceObject": { ...META, ...DECLARATION, ...UNIQUE_ID },
  "GVLObject.GVLObject": {
    ...META,
    ...DECLARATION,
    ParameterList: S("%PARAMETER_LIST"),
    AddAttributeSubsequent: S("the one measured value (no line; true refuses by name)", false),
    NetVarProperties: S("%NETVAR <member>: <value> (null: no line — a plain GVL)"),
    ...netVar("NetVarProperties", "%NETVAR <member>: <value>"),
  },
  "GVLObject.VarPersistentObject": {
    ...META,
    ...DECLARATION,
    guidinit: ID("vendor-minted"),
    guidcyclic: ID("vendor-minted"),
    dymmattributecount: {
      measure: "cache candidate: does a re-created list reproduce it? (design §1.1 VarPersistentObject)",
    },
    persvarlist: S("measured null on every occurrence (non-null refuses by name)", null),
    NetVarProperties: S("measured null on every occurrence", null),
  },
  "NVLObject.NVLObject": {
    ...META,
    ...DECLARATION,
    ReferenceGuidGVL: ID("vendor-minted (the sender list's identity)"),
    GuidTaskSlot: ID("vendor-minted (the task slot)"),
    SenderGVLName: S("%NETVAR SenderGVLName: <value> under %CLASS NVL"),
    TaskName: S("%NETVAR TaskName: <value> under %CLASS NVL"),
    ImportFromFile: S("%NETVAR ImportFromFile: <value> under %CLASS NVL"),
    ImportFileName: S("%NETVAR ImportFileName: <value> under %CLASS NVL"),
    ImportFileTimestamp: CACHE("nvl-import-timestamp"),
    ...netVar("ImportNetVarProperties", "%NETVAR ImportNetVarProperties.<member>: <value> under %CLASS NVL"),
  },
  // A standalone transition (design §1.2 "Transitions"): refused by name, every member — niche: accepted loss (0 in the
  // corpora; the fixture's one, VltOto_Trans, is authored for the red tests).
  "TransitionObject.TransitionObject": {
    "*": REFUSED("transition", "a standalone TransitionObject: niche: accepted loss (0 occurrences in the corpora)"),
  },
  "DefaultNavigators.FolderObject": {
    // A folder's BuildProperty is refused whole: the exact item entries above would otherwise win over the wildcard.
    ...Object.fromEntries(Object.entries(MEMBER_META).filter(([k]) => !k.startsWith("meta.Properties[BuildProperty]"))),
    "meta.Properties[BuildProperty]*": REFUSED("BuildProperty", "a folder's build property: folders are not items"),
    StructuredViewGuid: ID("vendor-minted"),
  },
  "TaskObject.TaskObject": {
    ...META,
    Kindoftask: S("Type:"),
    Interval: S("Interval:"),
    "Interval.Time": S("Interval:"),
    "Interval.Unit": S("Interval:"),
    Priority: S("Priority:"),
    Event: S("Event:"),
    ExternalEvent: S("External event:"),
    Watchdog: S("Watchdog: [off ]<time> <unit> (sensitivity <n>)"),
    "Watchdog.Enabled": S("Watchdog: [off ]…"),
    "Watchdog.Time": S("Watchdog: … <time> <unit> …"),
    "Watchdog.Time.Time": S("Watchdog: … <time> …"),
    "Watchdog.Time.Unit": S("Watchdog: … <unit> …"),
    "Watchdog.Sensitivity": S("Watchdog: … (sensitivity <n>)"),
    PouList: S("Calls:"),
    "PouList#count": S("Calls:"),
    "PouList[]": S("Calls:"),
    "PouList[].Name": S("Calls: <name>"),
    "PouList[].Comment": S("Calls: <name> // <comment>"),
    Core: S("Core: (only off its measured -1)"),
    Core2: S("Core2: (only off its measured -2)"),
    TaskGroup: S("Task group: (only off its measured 'IEC-Tasks')"),
    AllowEmpty: S("Allow empty: (only off its measured false)"),
    Implicit: S("Implicit: (only off its measured false)"),
    WithinSPSTimeSlicing: S("Within SPS time slicing: (only off its measured true)"),
    SynchTask: S("Synch task: (only off its measured '')"),
    ...Object.fromEntries(
      [
        "CustomParameters",
        "IntervalParameters",
        "EventParameters",
        "ExternalEventParameters",
        "FreewheelingParameters",
      ].flatMap((p): [string, Disposition][] => [
        [p, S("measured empty on 13/13")],
        [`${p}#count`, S("measured empty on 13/13 (non-empty refuses the task by name)", 0)],
        [`${p}[]*`, REFUSED(p, "a task parameter list Volt has no text form for")],
      ]),
    ),
    TaskGuid: ID("vendor-minted"),
    EventPOUGuid: ID("vendor-minted"),
  },
  "TaskObject.TaskPOUCallObject": {
    ...MEMBER_META,
    Commet: S("Calls: <name> // <comment> (where it differs from PouList[].Comment: measured equal)"),
    Id: ID("vendor-minted"),
  },
}

// ── TwinCAT: the files ──────────────────────────────────────────────────────────────────────────────────────────────

/** What every TwinCAT source file holds (design §1.1 "TwinCAT files"). */
function tcFile(obj: string): ClassTable {
  // The object element carries its Name attribute, so the archive reads it `<obj>[<name>]` — `[]` in the table's form.
  const o = `TcPlcObject/${obj}[]`
  return {
    $class: S("the kind (the file's extension)"),
    // The file's framing (the archive reads it apart since `[xml]` drops it): the IDE writes it on every save, so an
    // update and a create must reproduce it — a change fails by name.
    "$file#bom": S("the file's framing (UTF-8 BOM): written by the IDE, never by Volt"),
    "$file#declaration": S("the file's framing (the XML declaration, encoding included): written by the IDE"),
    "$file#comments": S("the file's framing (XML comments): written by the IDE"),
    TcPlcObject: S("the file"),
    "TcPlcObject/@Version": CACHE("editor-caches"),
    "TcPlcObject/@ProductVersion": CACHE("editor-caches"),
    [o]: S("the object"),
    [`${o}/@Name`]: S("the file name"),
    [`${o}/@Id`]: ID("the object GUID — owner decision: unspelled; new on every create"),
    [`${o}/Declaration`]: S("the declaration"),
    [`${o}/Declaration#text`]: S("the declaration, verbatim (trailing newlines included: trailing-newline-cache)"),
    [`${o}/LineIds*`]: CACHE("editor-caches"),
    [`${o}/ObjectProperties`]: S("the object-property carrier: empty = no property"),
    [`${o}/ObjectProperties#text`]: S("the object-property carrier: empty = no property", ""),
    [`${o}/ObjectProperties#xml`]: REFUSED(
      "ObjectProperties",
      "a TwinCAT object property with no measured member (the SFC archive travels with its body)",
    ),
    "plcproj/Compile": S("the item"),
    "plcproj/Compile/@Include": S("the folder and file name"),
    "plcproj/Compile/SubType": S("the measured value Code (13/13)"),
    "plcproj/Compile/SubType#text": S("the measured value (no line; another refuses by name)", "Code"),
    "plcproj/Compile/*": REFUSED(
      "Compile",
      "a .plcproj build entry other than SubType: no measured member (design §1.1 TwinCAT)",
    ),
  }
}

/** A graphical body's own element under `impl` — NWL (FBD / LD), CFC, SFC — and everything in it: `ld-fbd-coverage`'s.
 *  Only those: anything else below `Implementation` (an ST element's attribute, another language's element) is
 *  undecided, never skipped as that change's scope. */
function graphical(impl: string): ClassTable {
  const out: Record<string, Disposition> = {}
  for (const g of ["NWL", "CFC", "SFC"])
    out[`${impl}/${g}*`] = { scope: `ld-fbd-coverage (the ${g} body's internals)` }
  return out
}

/** A body and the members a POU or an interface holds, in its file. */
function tcBodies(o: string): ClassTable {
  const out: Record<string, Disposition> = {
    [`${o}/Implementation`]: S("the body's language (%LANGUAGE <LANG>)"),
    [`${o}/Implementation/ST`]: S("%LANGUAGE ST"),
    [`${o}/Implementation/ST#text`]: S("the body, verbatim"),
    ...graphical(`${o}/Implementation`),
  }
  // An accessor element may carry no Name attribute (then it reads `Get`, not `Get[]`): both forms are listed.
  const blocks = [
    "Method[]",
    "Action[]",
    "Property[]",
    "Property[]/Get[]",
    "Property[]/Set[]",
    "Property[]/Get",
    "Property[]/Set",
  ]
  for (const m of blocks) {
    const p = `${o}/${m}`
    out[p] = S(`the ${m.replaceAll("[]", "").replace("/", " ")} member block`)
    out[`${p}/@Name`] = S("the member name")
    out[`${p}/@Id`] = ID("the member GUID — vendor-minted, new on a create")
    out[`${p}/@FolderPath`] = S("%FOLDER")
    out[`${p}/Declaration`] = S("the member declaration")
    out[`${p}/Declaration#text`] = S("the member declaration, verbatim")
    out[`${p}/Implementation`] = S("the member body's language")
    out[`${p}/Implementation/ST`] = S("%LANGUAGE ST")
    out[`${p}/Implementation/ST#text`] = S("the member body, verbatim")
    Object.assign(out, graphical(`${p}/Implementation`))
    out[`${p}/LineIds*`] = CACHE("editor-caches")
    out[`${p}/ObjectProperties`] = S("the object-property carrier: empty = no property")
    out[`${p}/ObjectProperties#text`] = S("the object-property carrier: empty = no property", "")
    out[`${p}/ObjectProperties#xml`] = REFUSED(
      "ObjectProperties",
      "a TwinCAT object property with no measured member (the SFC archive travels with its body)",
    )
  }
  return out
}

const TWINCAT: Record<string, ClassTable> = {
  "TcPOU.POU": {
    ...tcFile("POU"),
    ...tcBodies("TcPlcObject/POU[]"),
    "TcPlcObject/POU[]/@SpecialFunc": S(
      "%CLASS CHECK … (None: no line; another value refuses the pull by name: tc-special-classes)",
      "None",
    ),
  },
  "TcDUT.DUT": tcFile("DUT"),
  "TcGVL.GVL": tcFile("GVL"),
  "TcIO.Itf": { ...tcFile("Itf"), ...tcBodies("TcPlcObject/Itf[]") },
  "TcTTO.Task": {
    ...tcFile("Task"),
    "TcPlcObject/Task[]/CycleTime": S("Interval:"),
    "TcPlcObject/Task[]/CycleTime#text": S("Interval:"),
    "TcPlcObject/Task[]/Priority": S("Priority:"),
    "TcPlcObject/Task[]/Priority#text": S("Priority:"),
    "TcPlcObject/Task[]/PouCall*": S("Calls:"),
    "TcPlcObject/Task[]/TaskFBGuid*": ID("vendor-minted (the task's implicit objects)"),
    "TcPlcObject/Task[]/CycleUpdate*": ID("vendor-minted (the task's implicit objects)"),
    "TcPlcObject/Task[]/PostCycleUpdate*": ID("vendor-minted (the task's implicit objects)"),
    "TcPlcObject/Task[]/Fb_init*": ID("vendor-minted (the task's implicit objects)"),
    "TcPlcObject/Task[]/Fb_exit*": ID("vendor-minted (the task's implicit objects)"),
  },
}

export const DISPOSITION: Readonly<Record<Vendor, Readonly<Record<string, ClassTable>>>> = {
  codesys: CODESYS,
  twincat: TWINCAT,
}

// ── lookup ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A member path in the table's form: every `[<index or key>]` reads `[]`, except a property's class
 *  (`meta.Properties[BuildProperty]`), which names WHICH property; a `#<n>` sibling tag is dropped. */
export function normalizeMember(path: string): string {
  return path.replace(/\[([^\]]*)\]/g, (m, inner: string, at: number) =>
    path.slice(0, at).endsWith("meta.Properties") ? m : "[]",
  )
}

/** The disposition of `member` of `cls`: its own entry, else the longest `<prefix>*` entry it falls under; undefined
 *  when the table does not list it (UNDECIDED). */
export function dispositionOf(vendor: Vendor, cls: string, member: string): Disposition | undefined {
  const table = DISPOSITION[vendor][cls]
  if (!table) return undefined
  const key = normalizeMember(member)
  if (key in table) return table[key]
  let best: string | undefined
  for (const k of Object.keys(table))
    if (k.endsWith("*") && key.startsWith(k.slice(0, -1)) && (!best || k.length > best.length)) best = k
  return best === undefined ? undefined : table[best]
}

/** Every vendor-facts row a `cache` entry cites, by vendor — what the oracle checks exists before it skips one. */
export function citedCacheRows(vendor: Vendor): string[] {
  const rows = new Set<string>()
  for (const t of Object.values(DISPOSITION[vendor]))
    for (const d of Object.values(t)) if ("cache" in d) rows.add(d.cache)
  return [...rows].sort()
}
