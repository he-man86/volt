/**
 * Language conformance — LSP vs recorded IDE ground truth (T.1, the D gate).
 *
 * Runs the LSP's semantic diagnostics over every catalog fixture and compares against PER-VENDOR
 * recordings captured from the LIVE compilers:
 *   - recordings/codesys.build.json  — CODESYS ground truth (VOLT_VENDOR=codesys)
 *   - recordings/twincat.build.json  — TwinCAT ground truth  (VOLT_VENDOR=twincat)
 * The active vendor selects the recording AND the LSP's config, because the two IDEs diverge at times.
 *
 * The single criterion is byte-identical: the LSP's error+warning message SET must equal the
 * compiler's. Two assertions encode the incremental build toward it:
 *   1. NO FALSE POSITIVES (hard, always green): every LSP message is a real IDE message (LSP ⊆ IDE).
 *      This is the safety guarantee — the LSP never invents an error the compiler didn't emit.
 *   2. AGREEMENT RATCHET: the count of fixtures whose sets match EXACTLY only ever rises. Each ported
 *      check lifts it toward full byte-identical parity; `KNOWN_DIVERGENCES` is the documented opt-out.
 *
 * The replay is pure — no live bridge. Re-record via `bun run record:language` against a bridge.
 */
import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseSource } from "../../src/syntax/index.js"
import { bindFile, buildSymbolTable, linkExtends, unbindFile, type Scope } from "../../src/symbols/index.js"
import { computeSemanticDiagnostics, messagesFor, resolveConfig, type Vendor } from "../../src/analysis/index.js"
import { computeNetworkTextDiagnostics } from "../../src/network/index.js"
import { plcPrgSource } from "./support/plc-prg.js"
import { STANDARD_LIBRARY } from "./support/standard-library.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { comparable } from "./support/compare-message.js"

interface RecordedDiagnostic {
  severity: "error" | "warning" | "info"
  message: string
  line: number
}
interface ExpectedRecording {
  recorded: { at: string } | null
  tests: Record<string, { buildSuccess: boolean; diagnostics: RecordedDiagnostic[] }>
}

function loadExpected(filename: string): ExpectedRecording {
  const path = join(import.meta.dir, "recordings", filename)
  const raw = JSON.parse(readFileSync(path, "utf8")) as ExpectedRecording
  return { recorded: raw.recorded, tests: raw.tests }
}

const RECORDINGS: ReadonlyArray<{ vendor: Vendor; filename: string; floor: number }> = [
  // floor = current exact-agreement count; raise as checks are ported, never lower.
  // + oop/ (interface-implementation) + pragmas/ (message + orphan-conditional) + names/
  // (unresolved-identifier): 231 TC / 228 CS of 259. Remaining non-agreements are documented IDE-only
  // divergences (parse cascades, app-config warnings, op_sys_* / __-system constructs) — not reproducible
  // offline; the subset (no-FP) gate stays green on them.
  // 253 → 255 (2026-09-14): gap 13 — untyped integer literals typed as CODESYS/TwinCAT type them (`overflow_*`).
  // 255 → 256: consolidate-lsp-structure A7 — the network-text jump-label check no longer fires on TwinCAT.
  { vendor: "twincat", filename: "twincat.build.json", floor: 265 },
  // the `???` slots match on text. 257 → 280 (2026-09-14): the LSP gaps the transpiler's execution oracle exposed —
  // `r`/`s` names, `**`, unary-minus and EXPT typing, set/reset chains — plus the operator-coverage fixtures
  // (coverage.test.ts), which found `&` is not a CODESYS operator either. Each recorded live and fixed.
  // 280 → 293 (2026-09-14): gaps 7 (a TIME literal's US/NS unit), 8 (LTIME literal typing), 9 (a library FUNCTION's
  // arguments), 11 (string arithmetic), 12 (a stray token after an initializer); the Standard library now in the CODESYS
  // replay project, as it is in the recording project; and declaration parse errors no longer counted twice here.
  // 293 → 311: gap 13 — an untyped integer literal the target cannot hold, typed as its narrowest integer type.
  // 311 → 315: consolidate-lsp-structure A2 — an L-prefixed date literal is the 64-bit type, printed in full.
  // 315 → 316: A4 — one conversion-name parser; the types it prints are the compiler's.
  // 316 → 318: A10 — one string-literal decoder; the assignment message counts decoded characters.
  // 318 → 333: A13 — declaration initializers type-checked like assignments (gap 14).
  // 333 → 349: A14 — IL operator names reserved as identifiers; C8 — a project enum's values and variables convert as INT.
  // 349 → 354: B6 — inference types an enum value, so call arguments and comparisons see it as assignments do.
  // 354 → 460 (2026-09-14): unify-conformance-suite §5 — the 117 execution programs build-recorded through the bridge.
  // 460 → 503: §5.2 — operand sign changes (arithmetic, bit operations, comparisons, MAX/MIN, NOT), a chained
  // assignment's inner store, an over-long WSTRING, a REAL literal beyond REAL, a typed literal sum; 37 `cc_*` probes.
  // 503 → 509: the six memory-model fixtures (transpile-st-to-rust design §9).
  // 509 → 521: the twelve call fixtures (`fb-call.ts`, transpile-st-to-rust phase 3).
  // 521 → 734 (2026-09-16): the fixture programme — 138 new fixtures across the cross-object, corpus-mined and
  // check-coverage batches, and the eleven LSP defects they found. The last jump, 717 → 734, is the IDE's parse-error
  // CASCADE after a reserved name, which no fixture could agree without.
  // 734 → 755 (2026-09-16): how often a DECLARATION'S INITIALIZER warning repeats. The IDE reports one twice — once
  // for the type, once for the instance initialisation it generates — and the LSP now does the same (measured with
  // `initializer-repeat.ts`: no instance 0, one instance 2, two instances 2, nested 2, PROGRAM 1; so it is per-type,
  // not per-instance). The goal is the IDE's answer, not a tidier one.
  // 849 -> 857 (2026-09-17): NINE ng_* fixtures whose recorded "ground truth" was of a project they never
  // entered. Their network text was not a round-trip fixed point, the bridge refused the push with
  // NETWORK_NOT_CANONICAL, and the recorder (then) logged a warning and wrote down the build anyway — so the
  // IDE side read `Unknown type: 'FB_NG_arith'`, which is PLC_PRG failing to find an FB that was never
  // created. Rewritten with the canonical body the refusal prints verbatim, eight now build CLEAN and the
  // ninth records real errors. No LSP change was involved in any of it.
    // 857 -> 859: `NOT` on a signed integer types as the UNSIGNED integer of its width (the result side of a
  // rule the operand side already had), and an ARRAY OF STRING(n) checks its elements.
  // 859 -> 862: the abstract ATTRIBUTE on a method without the ABSTRACT keyword warns; two probe fixtures
  // (`cc6_abstract_attribute_on_fb` / `_on_method`) established it is a METHOD rule, which `cc4_not_instantiable`
  // could not say because it carries the attribute on both and records one warning.
  { vendor: "codesys", filename: "codesys.build.json", floor: 862 },
]

/** Fixtures that legitimately do NOT match, each with a documented reason. Empty until a real divergence
 *  is confirmed against a recording (not a not-yet-ported check — those are tracked by the ratchet). */
// subrange is NO LONGER a divergence: the check now emits the compilers' own type-CONVERSION wording
// (`Cannot convert type '200' to type 'INT (1..100)'`, folded onto `cannotConvert`) — byte-identical on both,
// so it's in the ratchet. array-index-out-of-bounds is likewise byte-identical. The overflow fixtures are NOT
// here: the `constant-overflow` check was REMOVED (it false-positived — CODESYS accepts out-of-range untyped
// literals), so the LSP is silent on them; they read as honest "not-yet-implemented" misses.
const KNOWN_DIVERGENCES: Record<Vendor, ReadonlySet<string>> = {
  // TwinCAT does NOT flag a network-text JMP to a missing label (CODESYS does) — confirmed live 2026-07-07.
  // `cc_vg_undefined_label` was listed here: the LSP flagged the network-text JMP on TwinCAT too, a false positive this
  // set hid. The message is vendor data now (`networkJumpLabelUndefined`), undefined on TwinCAT — no divergence left.
  //   `op_sys_varinfo` — the TwinCAT RECORDING is truncated, not the behaviour: it stores `The code '.size;` with no
  //                       closing quote, where CODESYS stores the whole sentence including the line break it quotes.
  //                       The message is cut at that break on the way out of the TwinCAT driver — a BRIDGE bug to
  //                       fix and re-record, not something for the LSP to match.
  //   `operand_uchar_literal` — `UCHAR#'A'` is a CODESYS extension TwinCAT does not have: it parse-cascades on the
  //                       prefix (five errors), where CODESYS types the literal UDINT. The LSP's parser accepts the
  //                       extension for both, so it types the literal and TwinCAT sees a message it never emits.
  //                       The fix is a TwinCAT-only rejection of the prefix, in the shape `analysis/resync` already
  //                       models — TwinCAT work, deferred until CODESYS is finished.
  twincat: new Set<string>(["op_sys_varinfo", "operand_uchar_literal"]),
  // The `???` fixtures were here while the LSP answered every position with ONE invented sentence. They are
  // NOT divergences any more: the check reads the slot and emits the COMPILER'S wording for it
  // (`Expression expected instead of '?'` for an operand/pin/instance, `The assignment target is not
  // specified.` for a coil target), so they match on text like every other fixture.
  // Three checks the LSP emits that CODESYS does NOT — found by giving the untriggered checks their first fixtures
  // (2026-09-16). Each is recorded here with what the IDE says INSTEAD, because deleting a check on one measurement
  // is a decision, not a cleanup: each may still be right on TwinCAT, or in a shape this fixture does not reach.
  // Four of them are GONE (2026-09-16): each was an LSP message neither compiler emits in ANY recording, and the goal
  // is the IDE's answer, not a better one. `cc2_call_recursion` and `cc2_type_name_…` now say what CODESYS says;
  // `cc2_var_in_interface`'s rule is deleted (SP21 builds it clean); `cc5_no_op_statement` was a storage convention
  // (CRLF vs LF) and is normalized in `comparable()`.
  //   `cc5_pointer_not_convertible` — C0033 is CONFIGURABLE. The recording project has it as an ERROR; the replay
  //                            resolves no project settings, so it is a warning here. Configuration, not behaviour.
  //   `cc5_new_in_expression` — the recording device has no memory configured for dynamic creation, so the IDE
  //                            reports that instead and never reaches the nesting rule.
  //   `cc5_deprecated_functionblock_keyword` — the IDE does not report the spelling at all: it parses `FUNCTIONBLOCK`
  //                            as something else and reports "Unknown type". Both LSP messages are Volt's own.
  //   `sn_dut_mismatch_used` — THE RECORDING IS OF A PROJECT BUILD; A DIAGNOSTIC IS PER FILE. The fixture is an FB
  //                            holding `held : DUT_SN_signature`, and its recorded error — "The name used in the
  //                            signature is not identical to the object name" — is about the DUT, which is a
  //                            DIFFERENT OBJECT in a different file. `record:language` builds the fixture with
  //                            `withDependencies` and collects everything the build says, so the error lands under
  //                            this fixture's name; the LSP computes diagnostics for the file it is given, where
  //                            there is nothing wrong.
  //                            Analysing the dependencies too was tried and does close this one — and costs more
  //                            than it pays: `interface_with_property_impl` then reports the interface's
  //                            accessorless property, which CODESYS does NOT record, because that fixture sets no
  //                            `plcPrgVar` so nothing is instantiated and nothing is compiled. One gained, one
  //                            lost, plus a TwinCAT ratchet point. The rule "an implemented interface property is
  //                            silent" was written to explain it and is WRONG: `interface_with_property` has the
  //                            same interface AND an implementer in the project and still records the warning —
  //                            it instantiates the FB and reads the property, and the other does not.
  //                            What actually separates every one of these is REACHABILITY, which a per-file
  //                            analysis does not have and should not guess at.
  codesys: new Set<string>([
    "sn_dut_mismatch_used",
    "cc5_pointer_not_convertible",
    "cc5_new_in_expression",
    //   C0149, three fixtures, one cause — the compiler only looks at what it REACHES:
    //   `cc2_var_in_interface`, `itf_var_section_declaration` — an interface NOBODY IMPLEMENTS is never compiled,
    //                            so its VAR section draws no error. This is why the rule was wrongly deleted on
    //                            2026-09-16: a clean build on an unreferenced POU was read as "not an error".
    //                            `itf_var_section_inherited` adds an implementer and the error appears.
    //   `itf_var_section_inherited` — CODESYS reports the interface error and STOPS, never type-checking the FB
    //                            body, so `held` is never called undefined. An editor cannot stop: the body is
    //                            in front of the engineer and `held` is genuinely not there.
    "cc2_var_in_interface",
    "itf_var_section_declaration",
    "itf_var_section_inherited",
    //   `sn_dut_mismatch` — a DUT whose type name disagrees with its object, REFERENCED BY NOBODY. The same
    //                            reachability rule, and `sn_dut_mismatch_used` is the proof it is only that: add
    //                            one FB that declares a variable of the type and CODESYS reports the mismatch.
    "sn_dut_mismatch",
    //   `op_sys_new_delete` — the same device fact: the recording project configures no dynamic memory, so every
    //                            __NEW reports that instead of anything about the code.
    "op_sys_new_delete",
    "cc5_deprecated_functionblock_keyword",
    //   `cc6_loop_cannot_exit` — C0266 is CONFIGURABLE too, and the recording project has it OFF: the IDE warns only
    //                            about the sign change in `FOR small : SINT := 1 TO 200`, which the LSP matches.
    "cc6_loop_cannot_exit",
    //   `ir_initializer_warning_no_instance` — the IDE compiles only what the entry point REACHES, so a POU nobody
    //                            instantiates gets no diagnostics at all. An editor cannot work that way: it has to
    //                            answer about the file in front of you before anything instantiates it. The fixture
    //                            stays because the 0 it records is what proves the FB count is not per-declaration.
    "ir_initializer_warning_no_instance",
  ]),
}

// Cross-fixture declaration context: every fixture's interfaces/DUTs/GVLs and FBs (with their standalone
// method/property/action member units) are visible to the others, so `EXTENDS X` / `IMPLEMENTS X` / type refs
// AND inherited members resolve across fixtures. Each fixture is its own file, so a standalone method binds to
// the FB in its OWN fixture (no cross-fixture leak); fixture pouNames are unique (`FB_LANG_<name>`) so FBs
// don't collide. Only PROGRAM units are excluded (PLC_PRG is synthesized per fixture separately).
const PARSED = ALL_TESTS.map((t) => ({
  uri: `file:///conformance/${t.pouName}.${extFor(t.kind)}`,
  source: t.source,
  parseResult: parseSource(t.source),
}))
const CROSS_DECLS = PARSED.map((p) => ({
  uri: p.uri,
  source: p.source,
  parseResult: {
    units: p.parseResult.units.filter((u) => u.kind !== "program"),
    errors: [],
  },
}))
// The recorder builds each fixture with a PLC_PRG that instantiates + uses it; usage-only diagnostics
// (assignment in the caller, external write) live there, so synthesize + analyze it too.
const PLC_PRGS = ALL_TESTS.map((t) => {
  if (t.plcPrgVar === undefined && t.plcPrgBody === undefined) return undefined
  const source = plcPrgSource(t)
  // A DIRECTORY per fixture, so the file's BASE NAME is the object's name — `PLC_PRG.prg`, as a workspace has it.
  // It used to be `<fixture>__plcprg.fb`, which made every synthesized PLC_PRG look like a POU whose signature
  // disagrees with its object name (`signature-name`), and that is a real CODESYS error, not a harness detail.
  return { uri: `file:///conformance/${t.name}/PLC_PRG.prg`, source, parseResult: parseSource(source) }
})

function extFor(kind: string): string {
  const map: Record<string, string> = {
    function_block: "fb",
    function: "fun",
    program: "prg",
    gvl: "gvl",
    dut: "dut",
    interface: "itf",
  }
  return map[kind] ?? "fb"
}

// The CODESYS recording project references Standard, as every CODESYS project does, so a fixture calling LEN compiled
// against that library's declaration: replay against the same materialized files (gap 9, `cc_standard_len_wstring`).
// TwinCAT's standard library is Tc2_Standard, a different materialization — not added for it.
const CODESYS_STANDARD = STANDARD_LIBRARY.map((l) => ({ ...l, parseResult: parseSource(l.source) }))

/** Every error+warning message the LSP emits for a fixture (incl. parse errors + PLC_PRG usage). */
/**
 * ONE PROJECT PER VENDOR, EDITED IN PLACE — not one rebuilt per fixture.
 *
 * This used to call `buildSymbolTable` with `CROSS_DECLS.filter((_, i) => i !== testIdx)`: every fixture's
 * declarations except its own, bound from scratch, once per fixture. That is O(n^2) in the fixture count — at 1453
 * fixtures it is 2.1 million file-binds per vendor — and it timed out the moment a census sweep pushed n up by half.
 * The census will push it much further, so the shape had to change rather than the budget.
 *
 * The exclusion was only ever there because `CROSS_DECLS[i]` and `own` are the same file: binding both would declare
 * every fixture's own types twice. `unbindFile` takes that one file out by URI and `bindFile` puts it back, so the
 * project each fixture sees is EXACTLY what it saw before — every other fixture's declarations, plus its own units
 * with their programs, plus the standard library.
 */
const SHARED = new Map<Vendor, Scope>()
function sharedProject(vendor: Vendor): Scope {
  let project = SHARED.get(vendor)
  if (project === undefined) {
    project = buildSymbolTable([...CROSS_DECLS, ...(vendor === "codesys" ? CODESYS_STANDARD : [])])
    SHARED.set(vendor, project)
  }
  return project
}

function runLsp(testIdx: number, vendor: Vendor): string[] {
  const own = PARSED[testIdx] as (typeof PARSED)[number]
  const plc = PLC_PRGS[testIdx]
  const project = sharedProject(vendor)
  // swap this fixture's declaration-only copy for its real one, run, then put it back
  unbindFile(project, own.uri)
  bindFile(project, { uri: own.uri, parseResult: own.parseResult, source: own.source })
  if (plc) bindFile(project, { uri: plc.uri, parseResult: plc.parseResult, source: plc.source })
  linkExtends(project)
  try {
    return diagnose(own, plc, project, vendor)
  } finally {
    unbindFile(project, own.uri)
    if (plc) unbindFile(project, plc.uri)
    bindFile(project, CROSS_DECLS[testIdx]!)
    linkExtends(project)
  }
}

function diagnose(
  own: (typeof PARSED)[number],
  plc: (typeof PLC_PRGS)[number],
  project: Scope,
  vendor: Vendor,
): string[] {
  const config = resolveConfig({ vendor })
  const diags = computeSemanticDiagnostics({ parseResult: own.parseResult, source: own.source, project, config })
  if (plc) {
    diags.push(...computeSemanticDiagnostics({ parseResult: plc.parseResult, source: plc.source, project, config }))
  }
  // Graphical (network text) bodies: the semantic pass skips them; run the network text checks too so network text fixtures are covered.
  diags.push(...computeNetworkTextDiagnostics({ uri: own.uri, source: own.source, parseResult: own.parseResult }, project, messagesFor(vendor)))
  const msgs = diags
    .filter((d) => d.severity === "error" || d.severity === "warning")
    .map((d) => `[${d.severity}] ${comparable(d.message)}`)
  // No separate `parseResult.errors` here: `checkParseErrors` already reports them. Pushing them again counted every
  // DECLARATION parse error twice, so a fixture like `cc_decl_init_trailing_ident` could never agree exactly.
  return msgs.sort()
}

function ideMsgs(ds: readonly RecordedDiagnostic[]): string[] {
  return ds
    .filter((d) => d.severity === "error" || d.severity === "warning")
    .map((d) => `[${d.severity}] ${comparable(d.message)}`)
    .sort()
}

for (const { vendor, filename, floor } of RECORDINGS) {
  const expected = loadExpected(filename)
  const hasRecording = expected.recorded !== null

  describe(`language conformance (LSP vs ${vendor})`, () => {
    if (!hasRecording) {
      it.skip(`(no recording — run \`bun run record:language\` for ${vendor})`, () => {})
      return
    }

    let agree = 0
    const falsePositives: string[] = []
    const disagreed: { name: string; lsp: string[]; ide: string[] }[] = []
    for (let i = 0; i < ALL_TESTS.length; i++) {
      const test = ALL_TESTS[i] as (typeof ALL_TESTS)[number]
      const rec = expected.tests[test.name]
      if (rec === undefined || KNOWN_DIVERGENCES[vendor].has(test.name)) continue
      const lsp = runLsp(i, vendor)
      const ide = ideMsgs(rec.diagnostics)
      const ideSet = new Set(ide)
      for (const m of lsp) if (!ideSet.has(m)) falsePositives.push(`${test.name}: LSP-only ${m}`)
      // A fixture the LSP deliberately does not answer yet — the reason, with its date, is on the fixture — claims no
      // agreement. Its FALSE POSITIVES are still checked, just above: a deferral says "we do not emit this", never
      // "anything we emit here is fine".
      if (test.deferred?.lsp !== undefined) continue
      if (lsp.length === ide.length && lsp.every((m, k) => m === ide[k])) agree += 1
      else disagreed.push({ name: test.name, lsp, ide })
    }

    // `VOLT_REPLAY_REPORT=1 bun test test/conformance/replay.test.ts` — every fixture that is not exact agreement,
    // with both sides printed. The ratchet says HOW MANY are left; closing them needs to know WHICH, and grepping a
    // 890-entry recording by hand is how a session goes missing.
    if (process.env.VOLT_REPLAY_REPORT === "1") {
      // eslint-disable-next-line no-console
      console.log(`\n[${vendor}] ${disagreed.length} fixture(s) not in exact agreement:`)
      for (const d of disagreed) {
        const ideSet = new Set(d.ide)
        const lspSet = new Set(d.lsp)
        // eslint-disable-next-line no-console
        console.log(
          `\n  ${d.name}\n` +
            d.ide.map((m) => `    IDE  ${lspSet.has(m) ? " " : "-"} ${m}`).join("\n") +
            (d.ide.length > 0 ? "\n" : "") +
            d.lsp.map((m) => `    LSP  ${ideSet.has(m) ? " " : "+"} ${m}`).join("\n"),
        )
      }
    }

    it("emits NO false positives (every LSP message is a real IDE message)", () => {
      expect(falsePositives).toEqual([])
    })

    it(`agreement does not regress (>= ${floor})`, () => {
      // eslint-disable-next-line no-console
      console.log(`  [${vendor}] exact agreement: ${agree}/${ALL_TESTS.length} fixtures`)
      expect(agree).toBeGreaterThanOrEqual(floor)
    })
  })
}

/**
 * The class fix behind the cross-object batches (2026-09-16): a fixture written today had NO LSP oracle until somebody
 * brought the bridge up and re-recorded `codesys.build.json`, so it could sit green for weeks while the LSP reported
 * nonsense on it. It does have one. `codesys.run.json` says the case BUILT and RAN in the simulator — so every LSP ERROR
 * on it is a false positive, whether or not its diagnostics were ever recorded. Errors only: a build that succeeds still
 * emits warnings, and which ones is what the recorded agreement above is for. Weaker than that check (it cannot see a
 * diagnostic the LSP MISSES) and needs nothing but the run recording.
 */
describe("LSP vs the simulator run (every fixture CODESYS built and ran)", () => {
  const ran = JSON.parse(readFileSync(join(import.meta.dir, "recordings", "codesys.run.json"), "utf8")).tests as Record<string, { error?: string }>
  it("emits NO error on a fixture the IDE compiled and executed", () => {
    const falsePositives: string[] = []
    for (const [i, test] of ALL_TESTS.entries()) {
      const rec = ran[test.name]
      if (rec === undefined || rec.error !== undefined || test.source === "" || test.recorderSkip === true) continue
      if (KNOWN_DIVERGENCES.codesys.has(test.name)) continue
      for (const m of runLsp(i, "codesys")) if (m.startsWith("[error]")) falsePositives.push(`${test.name}: ${m}`)
    }
    expect(falsePositives).toEqual([])
  })
})
