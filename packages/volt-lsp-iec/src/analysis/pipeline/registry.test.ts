/**
 * THE REGISTRY'S CONTRACTS (openspec analysis-conformance design.md P3, §2; tasks 1.6, 1.7, 1.10): its run order, its
 * vendor table, the order of what a check reads from earlier findings, and every entry's home folder (A6's registry half).
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { parseSource } from "../../frontend/syntax/index.js"
import { build } from "../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig, runRegistry, messagesFor, type CheckContext } from "../index.js"
import { REGISTRY } from "./registry.js"

const ANALYSIS = join(import.meta.dir, "..")
const CHECKS = join(ANALYSIS, "checks")
const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? filesUnder(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : []
  })
/** Every check file: its group (its folder) and its text. */
const CHECK_FILES = readdirSync(CHECKS).flatMap((group) =>
  readdirSync(join(CHECKS, group))
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))
    .map((n) => ({ group, name: n, text: readFileSync(join(CHECKS, group, n), "utf8") })),
)

describe("the run order", () => {
  test("is exactly this list — a reorder is a decision, made here", () => {
    expect(REGISTRY.map((e) => e.check.name)).toEqual([
      "checkAssignmentTypes",
      "checkNarrowingConversion",
      "checkBinaryOperators",
      "checkConversionCalls",
      "checkDeref",
      "checkSubrange",
      "checkArrayBounds",
      "checkConstantOverflow",
      "checkBitNumber",
      "checkIndexing",
      "checkComparison",
      "checkArrayInit",
      "checkStructInit",
      "checkPointerConversion",
      "checkStringConstant",
      "checkReferenceAssign",
      "checkDataRecursion",
      "checkEnumInit",
      "checkUnaryOperand",
      "checkTypedLiteral",
      "checkCaseLabels",
      "checkStatementRules",
      "checkNewInExpression",
      "checkJumpLabels",
      "checkNoOpStatement",
      "checkEmptyBlock",
      "checkLoopExit",
      "checkThisSuperContext",
      "checkConstantContext",
      "checkDeclaredType",
      "checkConstantInitializer",
      "checkConstantCycle",
      "checkExternalInitializer",
      "checkExternalGlobal",
      "checkInputDefault",
      "checkBitUsage",
      "checkOutputRules",
      "checkNonInstantiable",
      "checkObsoleteUsage",
      "checkAtAddress",
      "checkHeaderRules",
      "checkAttributePlacement",
      "checkInheritance",
      "checkPropertyAccess",
      "checkMethodReference",
      "checkInheritedVariable",
      "checkCallArguments",
      "checkCallResultAccess",
      "checkRecursiveCall",
      "checkNonCallableCall",
      "checkIntrinsicOperands",
      "checkFbInstantiation",
      "checkDuplicateDeclarations",
      "checkUnresolvedIdentifiers",
      "checkAmbiguousGlobal",
      "checkTypeAsValue",
      "checkReservedKeyword",
      "checkVarSectionPlacement",
      "checkInoutInitializer",
      "checkExternalNonInputWrite",
      "checkInoutExternalAccess",
      "checkInoutOwnAccess",
      "checkConditionalCall",
      "checkUnknownType",
      "checkRefusedInitializer",
      "checkDynamicCreation",
      "checkFbInitInout",
      "checkFbInitInstantiation",
      "checkGenericInstantiation",
      "checkAbstractAssign",
      "checkLifecycleSignatures",
      "checkAbstractInstantiation",
      "checkInterfaceImplementations",
      "checkMethodSignatures",
      "checkAbstractOutputDefault",
      "checkPragmas",
      "checkSignatureName",
      "checkParseErrors",
      "checkUnknownSource",
    ])
  })

  test("every check is registered once", () => {
    const names = REGISTRY.map((e) => e.check.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test("every code a check reads is produced by registry checks that run BEFORE it, or by the network pass after the registry", () => {
    const network = [...filesUnder(join(ANALYSIS, "..", "network")), ...filesUnder(join(ANALYSIS, "..", "network-text"))].map((p) =>
      readFileSync(p, "utf8"),
    )
    const late: string[] = []
    REGISTRY.forEach((entry, at) => {
      for (const code of entry.reads ?? []) {
        const literal = `"${code}"`
        const producers = REGISTRY.flatMap((e, i) => {
          const file = CHECK_FILES.find((f) => new RegExp(`export function ${e.check.name}\\(`).test(f.text))!
          return file.text.includes(literal) ? [i] : []
        })
        if (producers.length === 0) {
          // not a registry code: the network pass's own, which runs after the registry with an `out` of its own
          expect(network.some((t) => t.includes(literal))).toBe(true)
          continue
        }
        for (const p of producers) if (p >= at) late.push(`${entry.check.name} reads ${code}, produced by ${REGISTRY[p]?.check.name}`)
      }
    })
    expect(late).toEqual([])
    // the one reader today, read LAST
    expect(REGISTRY.filter((e) => e.reads !== undefined).map((e) => e.check.name)).toEqual(["checkUnknownSource"])
    expect(REGISTRY.at(-1)!.check.name).toBe("checkUnknownSource")
  })
})

describe("the vendor table", () => {
  test("names the CODESYS-only checks, each with what was measured; nothing is TwinCAT-only today", () => {
    const scoped = REGISTRY.filter((e) => e.vendors !== "both")
    expect(scoped.map((e) => `${e.vendors} ${e.check.name}`)).toEqual([
      "codesys checkNewInExpression",
      "codesys checkConstantCycle",
      "codesys checkInputDefault",
      "codesys checkAttributePlacement",
      "codesys checkReservedKeyword",
      "codesys checkAbstractAssign",
      "codesys checkAbstractOutputDefault",
    ])
    for (const e of scoped) expect(e.note ?? "").not.toBe("")
  })

  test("the checks gated by a rule inside them say so on their entry", () => {
    for (const name of ["checkGenericInstantiation", "checkTypedLiteral"])
      expect(REGISTRY.find((e) => e.check.name === name)!.note).toMatch(/^rule gate:/)
  })

  test("a vendor's run is the registry minus the other vendor's entries", () => {
    const project = build.buildSymbolTable([], undefined, "twincat")
    const ran: string[] = []
    const ctx: CheckContext = {
      parseResult: { units: [], errors: [], failedDeclarations: [], tokens: [], dialect: "twincat" },
      source: "",
      uri: "empty.st",
      project,
      config: resolveConfig({ vendor: "twincat" }),
      messages: messagesFor("twincat"),
      tokens: () => [],
    }
    runRegistry(ctx, (check) => ran.push(check.name))
    expect(ran).toEqual(REGISTRY.filter((e) => e.vendors !== "codesys").map((e) => e.check.name))
  })
})

describe("groups", () => {
  const SEMANTIC = `FUNCTION_BLOCK FB_G
VAR
  nVal : INT;
END_VAR
nVal := nope;
END_FUNCTION_BLOCK
`
  const SYNTAX = SEMANTIC.replace("nVal := nope;", "nVal := ;")
  const run = (groups?: Parameters<typeof computeDiagnostics>[0]["groups"], src = SEMANTIC) => {
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "FB_G.pou", parseResult, source: src }])
    return computeDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }), uri: "FB_G.pou", groups })
  }

  test("unset runs every check", () => {
    expect(run().map((d) => d.code)).toEqual(["unresolved-identifier", "unknown-source"])
    expect(run(undefined, SYNTAX).map((d) => d.code)).toEqual(["syntax-error"])
  })

  test("a list runs only the checks of those groups", () => {
    expect(run(["names"]).map((d) => d.code)).toEqual(["unresolved-identifier"])
    expect(run(["syntax"])).toEqual([])
    expect(run(["syntax"], SYNTAX)).toEqual(run(undefined, SYNTAX))
    expect(run([])).toEqual([])
  })

  test("a list that holds a check reading earlier findings, but not every group, is refused by name", () => {
    // unknown-source (types) reports only where an earlier check of ANY group explained the hole: a "types" run would
    // silently drop the types finding CODESYS reports ("Cannot convert type 'Unknown type: 'nope'' to type 'INT'")
    expect(() => run(["types"])).toThrow(/checkUnknownSource.*reads/)
    expect(() => run(["types", "names"])).toThrow(/checkUnknownSource/)
    const every = [...new Set(REGISTRY.map((e) => e.group))]
    expect(run(every)).toEqual(run())
  })
})

describe("every registry entry lives in its group's folder (A6, the registry half)", () => {
  test("its function is defined in exactly one file, under checks/<group>/", () => {
    const misplaced: string[] = []
    for (const e of REGISTRY) {
      const where = CHECK_FILES.filter((f) => new RegExp(`export function ${e.check.name}\\(`).test(f.text))
      if (where.length !== 1) misplaced.push(`${e.check.name}: defined in ${where.length} files`)
      else if (where[0]?.group !== e.group) misplaced.push(`${e.check.name}: group ${e.group}, file checks/${where[0]?.group}/${where[0]?.name}`)
    }
    expect(misplaced).toEqual([])
  })
})
