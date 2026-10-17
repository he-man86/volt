/**
 * The completeness oracle's logic, offline (openspec `bridge-one-to-one` design §2.1): the disposition table's lookup,
 * the member-by-member judgement of two archives, the verdict against the expected failures, and the subject pick. The
 * live run (`bun scripts/completeness.ts <vendor>`) drives the same functions with the vendor cores.
 */
import { describe, expect, it } from "bun:test"
import { citedCacheRows, DISPOSITION, dispositionOf, normalizeMember } from "../../scripts/disposition.table"
import {
  compareArchives,
  knownKey,
  pickCodesys,
  mergeKnown,
  pickTwincat,
  refusalFinding,
  refusedCreateFindings,
  updateFindings,
  verdict,
  type Archive,
} from "../../scripts/completeness"
import { KNOWN } from "../../scripts/completeness.known"
import { ROWS } from "../../scripts/vendor-facts.table"

const ROW_IDS = new Set(ROWS.map((r) => r.id))
const POU = "POUObject.POUObject"

describe("the disposition table", () => {
  it("normalizes every index to [] except a property's class", () => {
    expect(normalizeMember("TextListObject.TextList[3].TextID")).toBe("TextListObject.TextList[].TextID")
    expect(normalizeMember("meta.Properties[BuildProperty].Undefines[0]")).toBe(
      "meta.Properties[BuildProperty].Undefines[]",
    )
    expect(normalizeMember("TcPlcObject/POU/Method[Run]/Declaration#text")).toBe(
      "TcPlcObject/POU/Method[]/Declaration#text",
    )
  })

  it("answers an exact entry before the longest wildcard, and nothing for an unlisted member", () => {
    expect(dispositionOf("codesys", POU, "meta.Properties[BuildProperty].ExcludeFromBuild")).toEqual({
      spelled: "%EXCLUDE_FROM_BUILD",
    })
    expect(dispositionOf("codesys", POU, "Implementation.TextDocument.Text")).toHaveProperty("spelled")
    expect(dispositionOf("codesys", POU, "meta.Properties[POUImageProperty].ImageData")).toEqual({
      refused: "a binary image has no text form",
      name: "POUImageProperty",
    })
    expect(dispositionOf("codesys", POU, "SomethingNew")).toBeUndefined()
    expect(dispositionOf("codesys", "Some.UnknownClass", "meta.Guid")).toBeUndefined()
  })

  // The CODESYS core reads a graphical implementation as its class alone, so a member BELOW `Implementation` is an ST
  // body's — never ld-fbd-coverage's: an unlisted one is undecided, not skipped as another change's scope.
  it("leaves an unlisted body member undecided (graphical bodies are their class alone)", () => {
    expect(dispositionOf("codesys", POU, "Implementation.SomeNewStMember")).toBeUndefined()
    expect(dispositionOf("codesys", POU, "Implementation.TextDocument.SomeNewMember")).toBeUndefined()
    expect(dispositionOf("codesys", "ActionObject.ActionObject", "Implementation.SomeNewStMember")).toBeUndefined()
  })

  // TwinCAT's file holds the graphical body's own elements (NWL / CFC / SFC): those are ld-fbd-coverage's; anything else
  // below `Implementation` (an ST attribute, another language's element) is undecided.
  it("scopes only the graphical body elements to ld-fbd-coverage (TwinCAT)", () => {
    const o = "TcPlcObject/POU[]"
    for (const g of ["NWL", "CFC", "SFC"]) {
      expect(dispositionOf("twincat", "TcPOU.POU", `${o}/Implementation/${g}`)).toHaveProperty("scope")
      expect(dispositionOf("twincat", "TcPOU.POU", `${o}/Implementation/${g}/Network[2]/@x`)).toHaveProperty("scope")
      expect(dispositionOf("twincat", "TcPOU.POU", `${o}/Method[Run]/Implementation/${g}/x`)).toHaveProperty("scope")
    }
    expect(dispositionOf("twincat", "TcPOU.POU", `${o}/Implementation/ST/@Novel`)).toBeUndefined()
    expect(dispositionOf("twincat", "TcPOU.POU", `${o}/Implementation/IL`)).toBeUndefined()
    expect(dispositionOf("twincat", "TcPOU.POU", `${o}/Method[Run]/Implementation/ST/@Novel`)).toBeUndefined()
  })

  // Review fix (gate step 2): the TwinCAT archive reads the file's framing `[xml]` dropped (BOM, XML declaration,
  // comments) — decided members, so a push that changes them fails by name; and a CRLF text is compared verbatim.
  it("decides the TwinCAT file framing, and compares a text's line endings", () => {
    for (const m of ["$file#bom", "$file#declaration", "$file#comments"])
      for (const cls of ["TcPOU.POU", "TcDUT.DUT", "TcGVL.GVL", "TcIO.Itf", "TcTTO.Task"])
        expect(dispositionOf("twincat", cls, m)).toHaveProperty("spelled")
    const decl = "TcPlcObject/POU[F]/Declaration#text"
    const t = (text: string): Archive => ({ "": { $class: "TcPOU.POU", [decl]: text } })
    const out = compareArchives("twincat", "F.pou", "update", t("A\r\nB\r\n"), t("A\nB\n"), "accepted", ROW_IDS)
    expect(out.findings.map((f) => [f.key, f.kind])).toEqual([["TcPOU.POU.TcPlcObject/POU[]/Declaration#text", "changed by the update"]])
  })

  it("refuses a folder's build property whole (folders are not items)", () => {
    expect(
      dispositionOf("codesys", "DefaultNavigators.FolderObject", "meta.Properties[BuildProperty].ExcludeFromBuild"),
    ).toHaveProperty("refused")
  })

  it("cites existing vendor-facts rows, except the three caches no row has measured yet", () => {
    const missing = [...citedCacheRows("codesys"), ...citedCacheRows("twincat")].filter((r) => !ROW_IDS.has(r))
    expect([...new Set(missing)].sort()).toEqual([
      "file-link-timestamp",
      "nvl-import-timestamp",
      "text-blob-serialisation",
    ])
  })

  it("lists the classes design §1.1 decides", () => {
    expect(Object.keys(DISPOSITION.codesys)).toContain("POUObject.POUObjectCheckFunction")
    expect(Object.keys(DISPOSITION.codesys)).toContain("TaskObject.TaskObject")
    expect(Object.keys(DISPOSITION.twincat)).toEqual(["TcPOU.POU", "TcDUT.DUT", "TcGVL.GVL", "TcIO.Itf", "TcTTO.Task"])
  })
})

describe("judging two archives", () => {
  const base: Archive = {
    "": {
      $class: POU,
      "meta.Guid": { $guid: "g1" },
      "meta.Timestamp": 1,
      POULevel: "Standard",
      "meta.Properties[BuildProperty].ExcludeFromBuild": true,
      "Interface.TextDocument.Text": "FUNCTION_BLOCK F\n",
    },
    Run: { $class: "MethodObject.POUMethodObject", "meta.Guid": { $guid: "g2" }, "meta.ParentGuid": { $guid: "g1" } },
  }

  it("passes an unchanged archive: identity, caches and spelled members equal", () => {
    expect(compareArchives("codesys", "F.pou", "update", base, base, "accepted", ROW_IDS).findings).toEqual([])
  })

  it("fails a spelled member that differs, by its class and member", () => {
    const after = { ...base, "": { ...base[""]!, "meta.Properties[BuildProperty].ExcludeFromBuild": false } }
    const { findings } = compareArchives("codesys", "F.pou", "create", base, after, "accepted", ROW_IDS)
    expect(findings.map((f) => f.key)).toEqual([`${POU}.meta.Properties[BuildProperty].ExcludeFromBuild`])
    expect(findings[0]!.what).toContain("true -> false")
  })

  it("lets a create mint a new identity, never an in-place write", () => {
    const after = { ...base, "": { ...base[""]!, "meta.Guid": { $guid: "g9" }, "meta.Timestamp": 2 } }
    expect(compareArchives("codesys", "F.pou", "create", base, after, "accepted", ROW_IDS).findings).toEqual([])
    expect(
      compareArchives("codesys", "F.pou", "update", base, after, "accepted", ROW_IDS).findings.map((f) => f.key),
    ).toEqual([`${POU}.meta.Guid`])
  })

  it("fails an undecided member and a member object the create lost", () => {
    const after: Archive = { "": { ...base[""]!, Novel: 1 } }
    const keys = compareArchives("codesys", "F.pou", "create", base, after, "accepted", ROW_IDS).findings.map(
      (f) => f.key,
    )
    expect(keys).toEqual([`${POU}.Novel`, "MethodObject.POUMethodObject.$object"])
  })

  it("passes a held refused member only when the refusal names it", () => {
    const held: Archive = { "": { ...base[""]!, "meta.Properties[POUImageProperty].ImageData": "bytes(3) abc" } }
    expect(
      compareArchives("codesys", "F.pou", "update", held, held, "accepted", ROW_IDS).findings.map((f) => f.key),
    ).toEqual([`${POU}.meta.Properties[POUImageProperty].ImageData`])
    expect(
      compareArchives("codesys", "F.pou", "update", held, held, "refused: UNSUPPORTED: POUImageProperty …", ROW_IDS)
        .findings,
    ).toEqual([])
  })

  it("fails a member off its measured constant, and a cache that cites no row", () => {
    const odd: Archive = { "": { ...base[""]!, POULevel: "Odd" } }
    expect(compareArchives("codesys", "F.pou", "update", odd, odd, "accepted", ROW_IDS).findings[0]!.what).toContain(
      "off its measured constant",
    )
    const gvl: Archive = { "": { $class: "GVLObject.GVLObject", "meta.Properties[FileLink].lTimeStamp": 5 } }
    expect(compareArchives("codesys", "G.gvl", "update", gvl, gvl, "accepted", ROW_IDS).findings[0]!.what).toContain(
      "'file-link-timestamp'",
    )
  })

  // A value the core could not read (raised, past the walk's depth, an object with no archive whose ToString names only
  // its class) compares equal to ANY other such value: it is a finding of its own, never a silent pass.
  it("fails a member whose value the core could not read, on either side", () => {
    const u = (why: string) => ({ $unreadable: why })
    const a: Archive = { "": { ...base[""]!, "meta.Properties[BuildProperty].ExcludeFromBuild": u("raised: boom") } }
    const out = compareArchives("codesys", "F.pou", "update", a, a, "accepted", ROW_IDS).findings
    expect(out.map((f) => [f.key, f.kind])).toEqual([
      [`${POU}.meta.Properties[BuildProperty].ExcludeFromBuild`, "unreadable"],
    ])
    expect(out[0]!.what).toContain("raised: boom")
    const b: Archive = { ...base, "": { ...base[""]!, "meta.Properties[BuildProperty].ExcludeFromBuild": u("<System.Version>") } }
    expect(compareArchives("codesys", "F.pou", "create", base, b, "accepted", ROW_IDS).findings.map((f) => f.kind)).toEqual([
      "unreadable",
    ])
    // A cache is never compared, so an unreadable cache is no finding.
    const c: Archive = { "": { ...base[""]!, "meta.Timestamp": u("<System.Foo>: deeper than 8") } }
    expect(compareArchives("codesys", "F.pou", "update", c, c, "accepted", ROW_IDS).findings).toEqual([])
  })

  // Review fix (gate step 2): an object whose archive NAMES could not be read (`$names`), whose children could not be
  // listed (`$children`) — the cores' markers, members no table lists — is unreadable, not merely undecided, and an
  // archive holding only its class never passes as a perfect round-trip.
  it("fails an unreadable archive marker as unreadable, on either side", () => {
    const u = { $unreadable: "SerializableValueNames raised: boom" }
    const a: Archive = { "": { $class: POU, $names: u } }
    expect(compareArchives("codesys", "F.pou", "update", a, a, "accepted", ROW_IDS).findings.map((f) => [f.key, f.kind])).toEqual([
      [`${POU}.$names`, "unreadable"],
    ])
    const kids: Archive = { "": { ...base[""]!, $children: { $unreadable: "get_children raised: x" } } }
    expect(compareArchives("codesys", "F.pou", "create", kids, kids, "accepted", ROW_IDS).findings.map((f) => f.kind)).toEqual([
      "unreadable",
    ])
  })

  it("tells a folded trailing newline from any other change of a text, by its kind", () => {
    const t = (text: string): Archive => ({ "": { ...base[""]!, "Interface.TextDocument.Text": text } })
    const kinds = (x: string, y: string) =>
      compareArchives("codesys", "F.pou", "create", t(x), t(y), "accepted", ROW_IDS).findings.map((f) => f.kind)
    expect(kinds("a := 1;\nb := 2;\n", "a := 1;\nb := 2;")).toEqual(["a trailing newline folded by the create"])
    expect(kinds("a := 1;\r\n", "a := 1;")).toEqual(["a trailing newline folded by the create"])
    expect(kinds("a := 1;\nb := 2;\n", "a := 1;\n")).toEqual(["changed by the create"])
    expect(kinds("a := 1;\n", "a := 2;\n")).toEqual(["changed by the create"])
    expect(kinds("a := 1;\n", "a := 1;\n\n")).toEqual(["changed by the create"])
    const lost = { ...base, "": { ...base[""]!, "meta.Properties[BuildProperty].ExcludeFromBuild": null } }
    expect(
      compareArchives("codesys", "F.pou", "update", base, lost, "accepted", ROW_IDS).findings.map((f) => f.kind),
    ).toEqual(["lost by the update"])
  })

  it("reports a measured cache candidate, never fails it", () => {
    const a: Archive = { "": { $class: "GVLObject.VarPersistentObject", dymmattributecount: 33 } }
    const c: Archive = { "": { $class: "GVLObject.VarPersistentObject", dymmattributecount: 0 } }
    const out = compareArchives("codesys", "P.gvl", "create", a, c, "accepted", ROW_IDS)
    expect(out.findings).toEqual([])
    expect(out.measurements).toMatchObject([{ key: "GVLObject.VarPersistentObject.dymmattributecount", equal: false }])
  })
})

describe("the verdict", () => {
  const CH = "changed by the create"
  const f = (key: string, subject = "x") => ({ key, kind: CH, subject, phase: "create" as const, what: "w" })
  const K = (key: string) => knownKey("codesys", { key, kind: CH })
  const E = (subjects: string[], why = "r") => ({ why, subjects })
  it("fails an unlisted failure and a listed entry that no longer fails for a subject the run ran", () => {
    const known = {
      [K("A.B.m")]: E(["x"]),
      [K("A.B.gone")]: E(["x"]),
      [K("C.D.m")]: E(["y"]),
      [`twincat:A.B.m — ${CH}`]: E(["x"]),
    }
    const v = verdict("codesys", [f("A.B.m"), f("A.B.new")], known, new Set(["x"]))
    expect(v).toEqual({
      unexpected: [`${K("A.B.new")} @ x`],
      stale: [`${K("A.B.gone")} @ x`],
      expected: [`${K("A.B.m")} @ x`],
    })
  })

  // Review fix (gate step 2): an entry is judged per SUBJECT, whatever its kind — an `--only` run judges no other
  // subject's entries (a 'changed by the create' of VltOto_CommentTask is not stale because VltOto_ExtTask ran).
  it("judges no entry of a subject this run did not run, whatever its kind", () => {
    const TASK = "TaskObject.TaskObject"
    const known = {
      [K(`${TASK}.PouList[].Comment`)]: E(["oto/VltOto_CommentTask.task"]),
      [K(`${TASK}.Event`)]: E(["oto/VltOto_ExtTask.task"]),
    }
    const ran = new Set(["oto/VltOto_ExtTask.task"])
    const v = verdict("codesys", [f(`${TASK}.Event`, "oto/VltOto_ExtTask.task")], known, ran)
    expect(v.stale).toEqual([])
    expect(v.unexpected).toEqual([])
  })

  // A known failure of one subject hides the same failure of no other subject.
  it("fails a known key on a subject its entry does not list", () => {
    const known = { [K("A.B.m")]: E(["x"]) }
    const v = verdict("codesys", [f("A.B.m", "x"), f("A.B.m", "z")], known, new Set(["x", "z"]))
    expect(v.unexpected).toEqual([`${K("A.B.m")} @ z`])
    expect(v.expected).toEqual([`${K("A.B.m")} @ x`])
  })

  // A known entry names the member AND what is wrong with it: the member's next, different loss is unexpected.
  it("fails another loss on a member whose known failure is a folded trailing newline", () => {
    const pou = (text: string): Archive => ({ "": { $class: POU, "Implementation.TextDocument.Text": text } })
    const folded = compareArchives("codesys", "X.pou", "update", pou("a := 1;\n"), pou("a := 1;"), "", ROW_IDS)
    const known = { [knownKey("codesys", folded.findings[0]!)]: E(["X.pou"]) }
    const dropped = compareArchives(
      "codesys",
      "X.pou",
      "update",
      pou("a := 1;\nb := 2;\n"),
      pou("a := 1;\n"),
      "",
      ROW_IDS,
    )
    const v = verdict("codesys", dropped.findings, known, new Set(["X.pou"]))
    expect(v.unexpected).toEqual([`codesys:${POU}.Implementation.TextDocument.Text — changed by the update @ X.pou`])
    expect(v.expected).toEqual([])
  })

  // A refusal is keyed by the refusal's codes; WHO was refused is the entry's subject list.
  it("keys a refused write by the refusal's codes, its subject by the entry", () => {
    const sfc = refusalFinding(POU, "VltFixtureSfc.pou", "create", "refused: UNSUPPORTED: 'CfcStep' is …")
    const st = refusalFinding(POU, "FB_Plain.pou", "create", "refused: UNSUPPORTED: 'x' is …")
    expect(sfc.kind).toBe("create refused: UNSUPPORTED")
    const known = { [knownKey("codesys", sfc)]: E(["VltFixtureSfc.pou"]) }
    const v = verdict("codesys", [sfc, st], known, new Set(["VltFixtureSfc.pou", "FB_Plain.pou"]))
    expect(v.unexpected).toEqual([`codesys:${POU}.$create — create refused: UNSUPPORTED @ FB_Plain.pou`])
  })

  // Review fix (gate step 2): a refusal that left part of the object behind is not the clean refusal.
  it("keeps a refusal's partiallyApplied / remains / renamedTo markers in its kind", () => {
    const clean = refusalFinding(POU, "S.pou", "create", "refused: UNSUPPORTED: cfc")
    const partial = refusalFinding(POU, "S.pou", "create", "refused: UNSUPPORTED: cfc [partiallyApplied] [remains]")
    const renamed = refusalFinding(POU, "S.pou", "update", "refused: REFUSED: x [renamedTo T.pou]")
    expect(clean.kind).toBe("create refused: UNSUPPORTED")
    expect(partial.kind).toBe("create refused: UNSUPPORTED [partiallyApplied] [remains]")
    expect(renamed.kind).toBe("update refused: REFUSED [renamedTo]")
  })

  // Review fix (gate step 2): a refused create that left an object behind is judged member by member; a clean one is
  // the refusal alone (every member is gone with the object, and the refusal says why).
  it("judges the object a refused create left behind, and only that", () => {
    const A: Archive = {
      "": { $class: POU, "Implementation.TextDocument.Text": "x := 1;\n", "Interface.TextDocument.Text": "FB F\n" },
    }
    const clean = refusedCreateFindings("codesys", POU, "S.pou", A, "refused: UNSUPPORTED: cfc", undefined, ROW_IDS)
    expect(clean.map((x) => x.kind)).toEqual(["create refused: UNSUPPORTED"])
    const out = "refused: UNSUPPORTED: cfc [partiallyApplied] [remains]"
    const left: Archive = { "": { $class: POU, "Interface.TextDocument.Text": "FB F\n" } }
    expect(refusedCreateFindings("codesys", POU, "S.pou", A, out, left, ROW_IDS).map((x) => [x.key, x.kind])).toEqual([
      [`${POU}.Implementation.TextDocument.Text`, "lost by the create"],
      [`${POU}.$create`, "create refused: UNSUPPORTED [partiallyApplied] [remains]"],
    ])
  })

  // The UPDATE phase: a refused write leaves the archive as it was — it must not read as a perfect round-trip.
  it("makes a refused update a finding of its own", () => {
    expect(updateFindings(POU, "F.pou", "accepted")).toEqual([])
    const [r] = updateFindings(POU, "F.pou", "refused: STALE_VERSION: the item changed | REFUSED: x")
    expect(r).toMatchObject({
      key: `${POU}.$update`,
      phase: "update",
      subject: "F.pou",
      kind: "update refused: STALE_VERSION, REFUSED",
    })
    expect(r!.what).toContain("STALE_VERSION: the item changed")
  })

  // Review fix (gate step 2): `--write-known` on an `--only` run replaces the entries of the subjects it RAN, and
  // keeps every other subject's (and the other vendor's).
  it("rewrites only the subjects a run ran", () => {
    const known = {
      [K("A.B.m")]: E(["x", "y"], "old"),
      [K("A.B.gone")]: E(["x"]),
      [K("A.B.other")]: E(["y"]),
      [`twincat:A.B.m — ${CH}`]: E(["x"]),
    }
    const out = mergeKnown("codesys", known, [{ ...f("A.B.new", "x"), what: "first" }], new Set(["x"]))
    expect(out).toEqual({
      [K("A.B.m")]: E(["y"], "old"),
      [K("A.B.new")]: E(["x"], "first"),
      [K("A.B.other")]: E(["y"]),
      [`twincat:A.B.m — ${CH}`]: E(["x"]),
    })
  })

  // Gate review of step 4b (findings 2 and 4): an entry whose subjects ALL ran and still fail kept its key but lost its
  // reason — dropped with its subjects, then re-made from the run's first finding. A reviewed reason ("niche: accepted
  // loss (N occurrences …)") vanished on the next `--write-known`, and a narrowed entry kept a reason naming a subject
  // it no longer held. A kept entry keeps its reason, whoever re-fails it.
  it("keeps the reviewed reason of an entry whose every subject ran and still fails", () => {
    const known = { [K("A.B.m")]: E(["x"], "niche: accepted loss (2 occurrences in the corpora)") }
    const out = mergeKnown("codesys", known, [{ ...f("A.B.m", "x"), what: "the run's own wording" }], new Set(["x"]))
    expect(out).toEqual({ [K("A.B.m")]: E(["x"], "niche: accepted loss (2 occurrences in the corpora)") })
  })

  it("keeps every known entry in the <vendor>:<class>.<member> — <kind> form, with the subjects that fail it", () => {
    for (const [k, e] of Object.entries(KNOWN)) {
      expect(k).toMatch(/^(codesys|twincat):[^.]+\.[^.]+\..+ — .+/)
      expect(e.subjects.length).toBeGreaterThan(0)
      expect(e.why.length).toBeGreaterThan(0)
    }
  })
})

describe("picking subjects", () => {
  it("covers every feature with as few wire items as it can (CODESYS)", () => {
    const o = (
      guid: string,
      name: string,
      cls: string,
      parent: string,
      extra: Partial<{ props: string[]; build: any }> = {},
    ) => ({ guid, name, class: cls, parent, props: extra.props ?? ["SVFoldersProperty"], build: extra.build ?? null })
    const objects = [
      o("p1", "FB_A", POU, "app"),
      o("m1", "Run", "MethodObject.AbstractPOUMethodObject", "p1"),
      o("p2", "FB_B", POU, "app", { build: { exclude: true, linkAlways: false, reserve: 0 } }),
      o("p3", "FB_C", POU, "app"),
      o("g1", "GVL", "GVLObject.GVLObject", "app"),
      o("t1", "Main", "TaskObject.TaskObject", "tc"),
      o("x1", "Lonely", POU, "app"),
    ]
    const items = { "FB_A.pou": "v", "Lib/FB_B.pou": "v", "FB_C.pou": "v", "GVL.gvl": "v", "Main.task": "v" }
    const { subjects: picked, uncovered } = pickCodesys(objects, items, [])
    expect(uncovered).toEqual([])
    expect(picked.map((s) => s.wire)).toEqual(["Main.task", "FB_A.pou", "Lib/FB_B.pou", "GVL.gvl"]) // every task first
    expect(picked[2]).toMatchObject({ folder: "Lib", why: "exclude:item" })
  })

  it("takes every source file TwinCAT loads (TwinCAT)", () => {
    const objects = [
      { name: "MAIN", itemType: 602, path: "a", file: "MAIN.TcPOU" },
      { name: "E", itemType: 605, path: "b", file: "E.TcDUT" },
      { name: "PlcTask", itemType: 621, path: "c", file: "PlcTask.TcTTO" },
      { name: "POUs", itemType: 601, path: "d", file: null },
    ]
    expect(
      pickTwincat(objects, { "MAIN.pou": "v", "E.dut": "v", "PlcTask.task": "v" }, []).subjects.map((s) => s.wire),
    ).toEqual(["E.dut", "MAIN.pou", "PlcTask.task"])
  })

  // Review fix (gate step 2): a wire item of a kind the oracle judges that no known item class maps to is never
  // skipped in silence — it is reported uncovered, by name (the run fails on it).
  it("reports a wire item no item class the oracle knows maps to", () => {
    const build = { exclude: true, linkAlways: false, reserve: 0 }
    const cs = pickCodesys(
      [{ guid: "g", name: "X", class: "POUObject.SomeOtherPou", parent: "", props: ["BuildProperty"], build }],
      { "X.pou": "v", "Dev.device": "v" },
      [],
    )
    expect(cs).toEqual({ subjects: [], uncovered: ["X.pou"] })
    const tc = pickTwincat([{ name: "Y", itemType: 602, path: "a", file: "Y.TcPOUx" }], { "Y.pou": "v", "L.library": "v" }, [])
    expect(tc).toEqual({ subjects: [], uncovered: ["Y.pou"] })
  })

  // Gate review of step 4b, finding 4: an item the pull REFUSES is no wire item, so it was no candidate — never judged,
  // and its known entries (VltFixtureSfc's: a trailing newline, a held transition) outlived every run as claims nobody
  // measured. Every refused item is a subject, as every task is: its refusal by name is what the run judges.
  it("takes every item the pull refuses, at the folder its unreadable name states (CODESYS and TwinCAT)", () => {
    const cs = pickCodesys(
      [
        { guid: "p1", name: "FB_A", class: POU, parent: "app", props: ["SVFoldersProperty"], build: null },
        { guid: "p2", name: "Sfc", class: POU, parent: "app", props: ["SVFoldersProperty"], build: null },
        { guid: "t1", name: "T", class: "TransitionObject.TransitionObject", parent: "p2", props: [], build: null },
        { guid: "v1", name: "Sfc", class: "VisualObject.VisualObject", parent: "app", props: [], build: null },
      ],
      { "App/FB_A.pou": "v" },
      ["App/Sfc"],
    )
    expect(cs.subjects.map((s) => [s.wire, s.folder, s.why])).toEqual([
      ["App/FB_A.pou", "App", "item:POUObject.POUObject"],
      ["App/Sfc.pou", "App", "every item the pull refuses"],
    ])
    const tc = pickTwincat(
      [
        { name: "MAIN", itemType: 602, path: "a", file: "MAIN.TcPOU" },
        { name: "Broken", itemType: 602, path: "b", file: "Broken.TcPOU" },
      ],
      { "Sys/PLC/P/MAIN.pou": "v" },
      ["Sys/PLC/P/Broken"],
    )
    expect(tc.subjects.map((s) => [s.wire, s.why])).toEqual([
      ["Sys/PLC/P/Broken.pou", "every item the pull refuses"],
      ["Sys/PLC/P/MAIN.pou", "MAIN.TcPOU"],
    ])
  })
})

describe("a finding's difference", () => {
  it("names where two texts part, so a folded trailing newline reads as one", async () => {
    const { difference } = await import("../../scripts/completeness")
    expect(difference("x := 1;\n", "x := 1;")).toBe('at character 7 of 8 -> 7: "x := 1;\\n" -> "x := 1;"')
    expect(difference(true, false)).toBe("true -> false")
  })
})
